//! [`AudioSystem`] backed by the real Windows Core Audio API, for outputs and inputs. Create and use it on one
//! thread that has joined the multithreaded apartment (the runtime thread).

use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, Instant};

use windows::core::{implement, Interface, Result as WinResult, GUID, HSTRING, PCWSTR, PWSTR};
use windows::Win32::Devices::FunctionDiscovery::{PKEY_Device_DeviceDesc, PKEY_Device_EnumeratorName, PKEY_Device_FriendlyName};
use windows::Win32::Foundation::{CloseHandle, PROPERTYKEY};
use windows::Win32::Media::Audio::Endpoints::{IAudioEndpointVolume, IAudioMeterInformation};
use windows::Win32::Media::Audio::{
    eCapture, eCommunications, eConsole, eMultimedia, eRender, EDataFlow, ERole, IAudioClient, IAudioSessionControl2,
    IAudioSessionManager2, IMMDevice, IMMDeviceEnumerator, IMMNotificationClient, IMMNotificationClient_Impl,
    MMDeviceEnumerator, AUDCLNT_SHAREMODE_SHARED, DEVICE_STATE, DEVICE_STATE_ACTIVE, DEVICE_STATE_DISABLED,
    DEVICE_STATE_UNPLUGGED, DEVICE_STATEMASK_ALL, PKEY_AudioEndpoint_FormFactor, WAVEFORMATEX,
};
use windows::Win32::System::Com::StructuredStorage::{PropVariantToStringAlloc, PropVariantToUInt32};
use windows::Win32::System::Com::{CoCreateInstance, CoTaskMemFree, CLSCTX_ALL, STGM_READ};
use windows::Win32::System::Threading::{OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION};
use windows::Win32::System::WinRT::RoGetActivationFactory;
use windows::Win32::UI::Shell::PropertiesSystem::IPropertyStore;

use super::classifier::{classify_connection, classify_kind};
use super::interop::*;
use super::*;

/// Called (on a COM thread) for every Core Audio notification. Must be quick and must not call back into audio.
pub type NotificationSink = Arc<dyn Fn(AudioNotification) + Send + Sync>;

/// PKEY_DeviceInterface_FriendlyName: "OnePlus Nord Buds 3 Pro" (the adapter / product name).
const PKEY_DEVICE_INTERFACE_FRIENDLY_NAME: PROPERTYKEY =
    PROPERTYKEY { fmtid: GUID::from_u128(0x026e516e_b814_414b_83cd_856d6fef4822), pid: 2 };

/// PnP instance path of the kernel-streaming filter behind the endpoint, e.g. "{1}.BTHENUM\{0000110b-…}"; a
/// transport hint when the enumerator name is missing.
const PKEY_ENDPOINT_KS_INSTANCE: PROPERTYKEY =
    PROPERTYKEY { fmtid: GUID::from_u128(0xb3f8fa53_0004_438e_9003_51a46e139bfc), pid: 2 };

/// Event context passed with volume changes so they can be told apart from the user's own.
const VOLUME_EVENT_CONTEXT: GUID = GUID::from_u128(0x6f1c1c39_6b0a_4c43_9f52_5e3c4f2b7a11);

/// 200 ms buffer for the silent mic monitor (100-ns units).
const MONITOR_BUFFER_HNS: i64 = 2_000_000;

const RENDER_INTERFACE: &str = "{e6327cad-dcec-4949-ae8a-991e976a79d2}";
const CAPTURE_INTERFACE: &str = "{2eef81be-33fa-4800-9670-1cd474972c3f}";

enum Policy {
    Modern(IPolicyConfig),
    Vista(IPolicyConfigVista),
}

enum Router {
    Modern(IAudioPolicyConfigFactory),
    Legacy(IAudioPolicyConfigFactoryLegacy),
}

pub struct CoreAudioSystem {
    enumerator: IMMDeviceEnumerator,
    client: IMMNotificationClient,
    policy: Option<Policy>,
    switch_unavailable: Option<String>,
    meters: HashMap<String, IAudioMeterInformation>,
    volumes: HashMap<String, IAudioEndpointVolume>,
    monitor: Option<IAudioClient>,
    monitor_id: Option<String>,
    router: Option<Router>,
    router_tried: bool,
}

impl CoreAudioSystem {
    /// The calling thread must already have initialised COM in the multithreaded apartment.
    pub fn new(sink: NotificationSink) -> WinResult<Self> {
        unsafe {
            let enumerator: IMMDeviceEnumerator = CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)?;
            let client: IMMNotificationClient = NotificationClient { sink }.into();
            enumerator.RegisterEndpointNotificationCallback(&client)?;

            let (policy, switch_unavailable) = match CoCreateInstance::<_, IPolicyConfig>(&CLSID_POLICY_CONFIG_CLIENT, None, CLSCTX_ALL) {
                Ok(p) => (Some(Policy::Modern(p)), None),
                Err(e1) => match CoCreateInstance::<_, IPolicyConfigVista>(&CLSID_POLICY_CONFIG_VISTA_CLIENT, None, CLSCTX_ALL) {
                    Ok(p) => (Some(Policy::Vista(p)), None),
                    Err(e2) => (None, Some(format!("IPolicyConfig: {}; IPolicyConfigVista: {}", e1.message(), e2.message()))),
                },
            };

            Ok(Self {
                enumerator,
                client,
                policy,
                switch_unavailable,
                meters: HashMap::new(),
                volumes: HashMap::new(),
                monitor: None,
                monitor_id: None,
                router: None,
                router_tried: false,
            })
        }
    }

    fn device(&self, id: &str) -> Option<IMMDevice> {
        let wide = HSTRING::from(id);
        unsafe { self.enumerator.GetDevice(PCWSTR(wide.as_ptr())).ok() }
    }

    fn active_device(&self, id: &str) -> Option<IMMDevice> {
        let device = self.device(id)?;
        let state = unsafe { device.GetState().ok()? };
        (state == DEVICE_STATE_ACTIVE).then_some(device)
    }

    fn default_id(&self, flow: AudioFlow, role: ERole) -> Option<String> {
        unsafe {
            // E_NOTFOUND when no endpoint of this flow is active.
            let device = self.enumerator.GetDefaultAudioEndpoint(data_flow(flow), role).ok()?;
            take_pwstr(device.GetId().ok()?)
        }
    }

    fn cached<T: Interface + Clone>(cache: &mut HashMap<String, T>, this: &Self, id: &str) -> Option<T> {
        if let Some(t) = cache.get(id) {
            return Some(t.clone());
        }
        let device = this.active_device(id)?;
        let t: T = unsafe { device.Activate(CLSCTX_ALL, None).ok()? };
        cache.insert(id.to_string(), t.clone());
        Some(t)
    }

    fn meter(&mut self, id: &str) -> Option<IAudioMeterInformation> {
        let mut cache = std::mem::take(&mut self.meters);
        let r = Self::cached(&mut cache, self, id);
        self.meters = cache;
        r
    }

    fn endpoint_volume(&mut self, id: &str) -> Option<IAudioEndpointVolume> {
        let mut cache = std::mem::take(&mut self.volumes);
        let r = Self::cached(&mut cache, self, id);
        self.volumes = cache;
        r
    }

    fn stop_monitor(&mut self) {
        if let Some(client) = self.monitor.take() {
            unsafe {
                let _ = client.Stop();
            }
        }
    }

    fn router(&mut self) -> Option<&Router> {
        if !self.router_tried {
            self.router_tried = true;
            let class = HSTRING::from("Windows.Media.Internal.AudioPolicyConfig");
            self.router = unsafe {
                RoGetActivationFactory::<IAudioPolicyConfigFactory>(&class)
                    .map(Router::Modern)
                    .or_else(|_| RoGetActivationFactory::<IAudioPolicyConfigFactoryLegacy>(&class).map(Router::Legacy))
                    .ok()
            };
        }
        self.router.as_ref()
    }

    fn read_endpoint(device: &IMMDevice, flow: AudioFlow) -> Option<AudioEndpoint> {
        unsafe {
            let id = take_pwstr(device.GetId().ok()?)?;
            let raw_state = device.GetState().unwrap_or(DEVICE_STATE(0));

            let mut friendly = id.clone();
            let mut description = String::new();
            let mut adapter = String::new();
            let mut enumerator = None;
            let mut ks_instance = None;
            let mut form_factor = -1;

            if let Ok(store) = device.OpenPropertyStore(STGM_READ) {
                if let Some(v) = read_string(&store, &PKEY_Device_FriendlyName) {
                    friendly = v;
                }
                description = read_string(&store, &PKEY_Device_DeviceDesc).unwrap_or_default();
                adapter = read_string(&store, &PKEY_DEVICE_INTERFACE_FRIENDLY_NAME).unwrap_or_default();
                enumerator = read_string(&store, &PKEY_Device_EnumeratorName);
                ks_instance = read_string(&store, &PKEY_ENDPOINT_KS_INSTANCE);
                if let Some(ff) = read_u32(&store, &PKEY_AudioEndpoint_FormFactor) {
                    form_factor = ff as i32;
                }
            }

            let connection = classify_connection(enumerator.as_deref(), ks_instance.as_deref(), &friendly, form_factor);
            let mut kind = classify_kind(form_factor, &friendly, &adapter, connection);
            if flow == AudioFlow::Capture && !matches!(kind, DeviceKind::Headset | DeviceKind::Earbuds | DeviceKind::Display) {
                kind = DeviceKind::Microphone;
            }

            Some(AudioEndpoint {
                id,
                friendly_name: friendly,
                description,
                adapter_name: adapter,
                flow,
                state: match raw_state {
                    DEVICE_STATE_ACTIVE => EndpointState::Active,
                    DEVICE_STATE_DISABLED => EndpointState::Disabled,
                    DEVICE_STATE_UNPLUGGED => EndpointState::Unplugged,
                    _ => EndpointState::NotPresent,
                },
                connection,
                kind,
                form_factor,
            })
        }
    }
}

impl AudioSystem for CoreAudioSystem {
    fn can_switch(&self) -> bool {
        self.policy.is_some()
    }

    fn switch_unavailable_reason(&self) -> Option<String> {
        self.switch_unavailable.clone()
    }

    fn endpoints(&mut self, flow: AudioFlow) -> Vec<AudioEndpoint> {
        let mut list = Vec::new();
        unsafe {
            let Ok(collection) = self.enumerator.EnumAudioEndpoints(data_flow(flow), DEVICE_STATE(DEVICE_STATEMASK_ALL)) else { return list };
            let count = collection.GetCount().unwrap_or(0);
            for i in 0..count {
                if let Ok(device) = collection.Item(i) {
                    if let Some(e) = Self::read_endpoint(&device, flow) {
                        list.push(e);
                    }
                }
            }
        }
        list
    }

    fn defaults(&mut self, flow: AudioFlow) -> DefaultEndpoints {
        DefaultEndpoints {
            console: self.default_id(flow, eConsole),
            multimedia: self.default_id(flow, eMultimedia),
            communications: self.default_id(flow, eCommunications),
        }
    }

    fn set_default(&mut self, flow: AudioFlow, device_id: &str, include_communications: bool) -> SwitchResult {
        let Some(policy) = &self.policy else {
            return SwitchResult::fail(format!(
                "Switching is unavailable on this system: {}",
                self.switch_unavailable.clone().unwrap_or_default()
            ));
        };
        let Some(device) = self.device(device_id) else { return SwitchResult::fail("Device not found.") };
        if unsafe { device.GetState().ok() } != Some(DEVICE_STATE_ACTIVE) {
            return SwitchResult::fail("Device is not connected.");
        }

        let roles: &[(ERole, &str)] = if include_communications {
            &[(eConsole, "Console"), (eMultimedia, "Multimedia"), (eCommunications, "Communications")]
        } else {
            &[(eConsole, "Console"), (eMultimedia, "Multimedia")]
        };
        let wide = HSTRING::from(device_id);
        for (role, name) in roles {
            // The policy client infers the flow from the endpoint ID itself.
            let hr = unsafe {
                match policy {
                    Policy::Modern(p) => set_default_endpoint_modern(p, PCWSTR(wide.as_ptr()), *role),
                    Policy::Vista(p) => set_default_endpoint_vista(p, PCWSTR(wide.as_ptr()), *role),
                }
            };
            if hr.is_err() {
                let mut r = SwitchResult::fail(format!("SetDefaultEndpoint({name}) failed with 0x{:08X}.", hr.0 as u32));
                r.hresult = Some(hr.0);
                r.observed = Some(self.defaults(flow));
                return r;
            }
        }

        // Verify by re-reading the defaults. The change is normally visible immediately, but give the audio service
        // up to ~2 s before declaring failure.
        let started = Instant::now();
        loop {
            let observed = self.defaults(flow);
            let ok = observed.console.as_deref() == Some(device_id)
                && observed.multimedia.as_deref() == Some(device_id)
                && (!include_communications || observed.communications.as_deref() == Some(device_id));
            if ok {
                return SwitchResult::ok(format!("Verified in {} ms", started.elapsed().as_millis()), observed);
            }
            if started.elapsed() >= Duration::from_millis(2000) {
                let mut r = SwitchResult::fail("Windows accepted the request but the default device did not change.");
                r.observed = Some(observed);
                return r;
            }
            std::thread::sleep(Duration::from_millis(50));
        }
    }

    fn peak(&mut self, device_id: &str) -> Option<f32> {
        let meter = self.meter(device_id)?;
        match unsafe { meter.GetPeakValue() } {
            Ok(p) => Some(p),
            Err(_) => {
                // A disconnected device invalidates the interface: drop it and retry next time.
                self.meters.remove(device_id);
                None
            }
        }
    }

    fn set_capture_monitor(&mut self, device_id: Option<&str>) -> bool {
        if device_id == self.monitor_id.as_deref() {
            return self.monitor.is_some() || device_id.is_none();
        }
        self.stop_monitor();
        self.monitor_id = device_id.map(str::to_string);
        let Some(id) = device_id else { return true };
        let Some(device) = self.device(id) else { return false };
        unsafe {
            let Ok(client) = device.Activate::<IAudioClient>(CLSCTX_ALL, None) else { return false };
            let Ok(format) = client.GetMixFormat() else { return false };
            // Shared mode, no event callback: the buffer is never read, Windows just overwrites it.
            let init = client.Initialize(AUDCLNT_SHAREMODE_SHARED, 0, MONITOR_BUFFER_HNS, 0, format as *const WAVEFORMATEX, None);
            CoTaskMemFree(Some(format as *const _));
            if init.is_err() || client.Start().is_err() {
                return false;
            }
            self.monitor = Some(client);
        }
        true
    }

    fn volume(&mut self, device_id: &str) -> Option<VolumeInfo> {
        let v = self.endpoint_volume(device_id)?;
        unsafe {
            match (v.GetMasterVolumeLevelScalar(), v.GetMute()) {
                (Ok(level), Ok(muted)) => Some(VolumeInfo { level, muted: muted.as_bool() }),
                _ => {
                    self.volumes.remove(device_id);
                    None
                }
            }
        }
    }

    fn set_volume(&mut self, device_id: &str, level: f32) -> Option<VolumeInfo> {
        let v = self.endpoint_volume(device_id)?;
        if unsafe { v.SetMasterVolumeLevelScalar(level.clamp(0.0, 1.0), &VOLUME_EVENT_CONTEXT) }.is_err() {
            self.volumes.remove(device_id);
            return None;
        }
        self.volume(device_id)
    }

    fn set_mute(&mut self, device_id: &str, muted: bool) -> Option<VolumeInfo> {
        let v = self.endpoint_volume(device_id)?;
        if unsafe { v.SetMute(muted, &VOLUME_EVENT_CONTEXT) }.is_err() {
            self.volumes.remove(device_id);
            return None;
        }
        self.volume(device_id)
    }

    fn sessions(&mut self, device_id: &str) -> Vec<AudioSessionInfo> {
        let mut result = Vec::new();
        let Some(device) = self.active_device(device_id) else { return result };
        unsafe {
            let Ok(manager) = device.Activate::<IAudioSessionManager2>(CLSCTX_ALL, None) else { return result };
            let Ok(sessions) = manager.GetSessionEnumerator() else { return result };
            let count = sessions.GetCount().unwrap_or(0);
            for i in 0..count {
                let Ok(control) = sessions.GetSession(i) else { continue };
                let Ok(session) = control.cast::<IAudioSessionControl2>() else { continue };
                let pid = session.GetProcessId().unwrap_or(0);
                let state = session.GetState().map(|s| s.0).unwrap_or(0);
                let system = session.IsSystemSoundsSession() == windows::Win32::Foundation::S_OK;
                result.push(AudioSessionInfo { process_id: pid, process_name: process_name(pid), state, is_system_sounds: system });
            }
        }
        result
    }

    fn app_route(&mut self, pid: u32, flow: AudioFlow) -> Option<String> {
        let router = self.router()?;
        let mut raw = std::ptr::null_mut();
        let hr = unsafe {
            match router {
                Router::Modern(r) => get_app_endpoint_modern(r, pid, data_flow(flow), eConsole, &mut raw),
                Router::Legacy(r) => get_app_endpoint_legacy(r, pid, data_flow(flow), eConsole, &mut raw),
            }
        };
        if hr.is_err() {
            return None;
        }
        let path = unsafe { hstring_from_raw(raw) }.to_string();
        // "\\?\SWD#MMDEVAPI#{0.0.0.00000000}.{guid}#{interface}" → "{0.0.0.00000000}.{guid}"
        let parts: Vec<&str> = path.split('#').collect();
        Some(if parts.len() >= 3 { parts[2].to_string() } else { path })
    }

    fn set_app_route(&mut self, pid: u32, flow: AudioFlow, endpoint_id: &str, include_communications: bool) -> i32 {
        let Some(router) = self.router() else { return E_NOTIMPL };
        let path = if endpoint_id.is_empty() {
            HSTRING::new()
        } else {
            let interface = if flow == AudioFlow::Capture { CAPTURE_INTERFACE } else { RENDER_INTERFACE };
            HSTRING::from(format!("\\\\?\\SWD#MMDEVAPI#{endpoint_id}#{interface}"))
        };
        let roles: &[ERole] = if include_communications { &[eConsole, eMultimedia, eCommunications] } else { &[eConsole, eMultimedia] };
        for role in roles {
            let hr = unsafe {
                match router {
                    Router::Modern(r) => set_app_endpoint_modern(r, pid, data_flow(flow), *role, hstring_as_raw(&path)),
                    Router::Legacy(r) => set_app_endpoint_legacy(r, pid, data_flow(flow), *role, hstring_as_raw(&path)),
                }
            };
            if hr.is_err() {
                return hr.0;
            }
        }
        0
    }

    fn on_notification(&mut self, n: &AudioNotification) {
        if matches!(n.kind, NotificationKind::StateChanged | NotificationKind::Removed) {
            if let Some(id) = &n.device_id {
                self.meters.remove(id);
                self.volumes.remove(id);
            }
        }
    }
}

impl Drop for CoreAudioSystem {
    fn drop(&mut self) {
        self.stop_monitor();
        unsafe {
            let _ = self.enumerator.UnregisterEndpointNotificationCallback(&self.client);
        }
    }
}

/// COM callback sink. Per the docs, callbacks must return quickly and must not call into MMDevice APIs.
#[implement(IMMNotificationClient)]
struct NotificationClient {
    sink: NotificationSink,
}

impl NotificationClient {
    fn raise(&self, kind: NotificationKind, id: &PCWSTR, flow: Option<AudioFlow>) {
        let device_id = if id.is_null() { None } else { unsafe { id.to_string().ok() } };
        (self.sink)(AudioNotification { kind, device_id, flow });
    }
}

#[allow(non_snake_case)]
impl IMMNotificationClient_Impl for NotificationClient_Impl {
    fn OnDeviceStateChanged(&self, id: &PCWSTR, _state: DEVICE_STATE) -> WinResult<()> {
        self.raise(NotificationKind::StateChanged, id, None);
        Ok(())
    }

    fn OnDeviceAdded(&self, id: &PCWSTR) -> WinResult<()> {
        self.raise(NotificationKind::Added, id, None);
        Ok(())
    }

    fn OnDeviceRemoved(&self, id: &PCWSTR) -> WinResult<()> {
        self.raise(NotificationKind::Removed, id, None);
        Ok(())
    }

    fn OnDefaultDeviceChanged(&self, flow: EDataFlow, _role: ERole, id: &PCWSTR) -> WinResult<()> {
        if flow == eRender || flow == eCapture {
            let f = if flow == eCapture { AudioFlow::Capture } else { AudioFlow::Render };
            self.raise(NotificationKind::DefaultChanged, id, Some(f));
        }
        Ok(())
    }

    fn OnPropertyValueChanged(&self, id: &PCWSTR, key: &PROPERTYKEY) -> WinResult<()> {
        // Only friendly-name changes matter to the UI; everything else (volume, formats…) is noise.
        if key.fmtid == PKEY_Device_FriendlyName.fmtid && key.pid == PKEY_Device_FriendlyName.pid {
            self.raise(NotificationKind::PropertyChanged, id, None);
        }
        Ok(())
    }
}

fn data_flow(flow: AudioFlow) -> EDataFlow {
    if flow == AudioFlow::Capture {
        eCapture
    } else {
        eRender
    }
}

/// Copies a COM-allocated string and frees it.
unsafe fn take_pwstr(p: PWSTR) -> Option<String> {
    if p.is_null() {
        return None;
    }
    let s = p.to_string().ok();
    CoTaskMemFree(Some(p.0 as *const _));
    s
}

unsafe fn read_string(store: &IPropertyStore, key: &PROPERTYKEY) -> Option<String> {
    let value = store.GetValue(key).ok()?;
    let s = take_pwstr(PropVariantToStringAlloc(&value).ok()?)?;
    (!s.is_empty()).then_some(s)
}

unsafe fn read_u32(store: &IPropertyStore, key: &PROPERTYKEY) -> Option<u32> {
    let value = store.GetValue(key).ok()?;
    PropVariantToUInt32(&value).ok()
}

/// The process's executable name without ".exe" (like .NET's Process.ProcessName).
fn process_name(pid: u32) -> String {
    if pid == 0 {
        return "System".into();
    }
    unsafe {
        let Ok(handle) = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) else { return format!("pid {pid}") };
        let mut buf = [0u16; 1024];
        let mut len = buf.len() as u32;
        let ok = QueryFullProcessImageNameW(handle, PROCESS_NAME_WIN32, PWSTR(buf.as_mut_ptr()), &mut len).is_ok();
        let _ = CloseHandle(handle);
        if !ok {
            return format!("pid {pid}");
        }
        let path = String::from_utf16_lossy(&buf[..len as usize]);
        std::path::Path::new(&path).file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or(path)
    }
}
