//! Hand-declared COM interfaces Windows doesn't document (so they aren't in the `windows` crate).
//!
//! * `IPolicyConfig` (and the older `IPolicyConfigVista` layout): the only way to change the system default audio
//!   endpoint; the Sound control panel uses it. Stable since Windows 7, but Microsoft may change it, so every switch
//!   is verified by re-reading the defaults and "switching unavailable" is reported if neither layout activates.
//! * `IAudioPolicyConfigFactory`: the WinRT factory behind "App volume and device preferences", used to see and
//!   clear an app's per-app device. Its IID changed in Windows 10 21H2; both are tried.
//!
//! Only a few methods are called; the earlier vtable slots exist to keep the slot indexes right.
#![allow(non_snake_case, clippy::upper_case_acronyms)]

use std::ffi::c_void;
use windows::core::{GUID, HRESULT, HSTRING, IUnknown, IUnknown_Vtbl, Interface, PCWSTR};
use windows::Win32::Media::Audio::{EDataFlow, ERole};

pub const CLSID_POLICY_CONFIG_CLIENT: GUID = GUID::from_u128(0x870af99c_171d_4f9e_af0d_e63df40c2bc9);
pub const CLSID_POLICY_CONFIG_VISTA_CLIENT: GUID = GUID::from_u128(0x294935ce_f637_4e7c_a41b_ab255460b862);

#[windows::core::interface("f8679f50-850a-41cf-9c72-430f290290c8")]
pub unsafe trait IPolicyConfig: IUnknown {
    fn GetMixFormat(&self, id: PCWSTR, format: *mut c_void) -> HRESULT;
    fn GetDeviceFormat(&self, id: PCWSTR, default: i32, format: *mut c_void) -> HRESULT;
    fn ResetDeviceFormat(&self, id: PCWSTR) -> HRESULT;
    fn SetDeviceFormat(&self, id: PCWSTR, endpoint: *mut c_void, mix: *mut c_void) -> HRESULT;
    fn GetProcessingPeriod(&self, id: PCWSTR, default: i32, a: *mut c_void, b: *mut c_void) -> HRESULT;
    fn SetProcessingPeriod(&self, id: PCWSTR, period: *mut c_void) -> HRESULT;
    fn GetShareMode(&self, id: PCWSTR, mode: *mut c_void) -> HRESULT;
    fn SetShareMode(&self, id: PCWSTR, mode: *mut c_void) -> HRESULT;
    fn GetPropertyValue(&self, id: PCWSTR, key: *mut c_void, value: *mut c_void) -> HRESULT;
    fn SetPropertyValue(&self, id: PCWSTR, key: *mut c_void, value: *mut c_void) -> HRESULT;
    fn SetDefaultEndpoint(&self, id: PCWSTR, role: ERole) -> HRESULT;
    fn SetEndpointVisibility(&self, id: PCWSTR, visible: i32) -> HRESULT;
}

#[windows::core::interface("568b9108-44bf-40b4-9006-86afe5b5a620")]
pub unsafe trait IPolicyConfigVista: IUnknown {
    fn GetMixFormat(&self, id: PCWSTR, format: *mut c_void) -> HRESULT;
    fn GetDeviceFormat(&self, id: PCWSTR, default: i32, format: *mut c_void) -> HRESULT;
    fn SetDeviceFormat(&self, id: PCWSTR, endpoint: *mut c_void, mix: *mut c_void) -> HRESULT;
    fn GetProcessingPeriod(&self, id: PCWSTR, default: i32, a: *mut c_void, b: *mut c_void) -> HRESULT;
    fn SetProcessingPeriod(&self, id: PCWSTR, period: *mut c_void) -> HRESULT;
    fn GetShareMode(&self, id: PCWSTR, mode: *mut c_void) -> HRESULT;
    fn SetShareMode(&self, id: PCWSTR, mode: *mut c_void) -> HRESULT;
    fn GetPropertyValue(&self, id: PCWSTR, key: *mut c_void, value: *mut c_void) -> HRESULT;
    fn SetPropertyValue(&self, id: PCWSTR, key: *mut c_void, value: *mut c_void) -> HRESULT;
    fn SetDefaultEndpoint(&self, id: PCWSTR, role: ERole) -> HRESULT;
    fn SetEndpointVisibility(&self, id: PCWSTR, visible: i32) -> HRESULT;
}

/// IInspectable's three methods are declared explicitly, then 21 slots Waypoint never calls, then the three it does.
macro_rules! audio_policy_config_factory {
    ($name:ident, $iid:literal) => {
        #[windows::core::interface($iid)]
        pub unsafe trait $name: IUnknown {
            fn GetIids(&self, count: *mut u32, iids: *mut *mut GUID) -> HRESULT;
            fn GetRuntimeClassName(&self, name: *mut *mut c_void) -> HRESULT;
            fn GetTrustLevel(&self, level: *mut i32) -> HRESULT;
            fn Unused01(&self) -> HRESULT;
            fn Unused02(&self) -> HRESULT;
            fn Unused03(&self) -> HRESULT;
            fn Unused04(&self) -> HRESULT;
            fn Unused05(&self) -> HRESULT;
            fn Unused06(&self) -> HRESULT;
            fn Unused07(&self) -> HRESULT;
            fn Unused08(&self) -> HRESULT;
            fn Unused09(&self) -> HRESULT;
            fn Unused10(&self) -> HRESULT;
            fn Unused11(&self) -> HRESULT;
            fn Unused12(&self) -> HRESULT;
            fn Unused13(&self) -> HRESULT;
            fn Unused14(&self) -> HRESULT;
            fn Unused15(&self) -> HRESULT;
            fn Unused16(&self) -> HRESULT;
            fn Unused17(&self) -> HRESULT;
            fn Unused18(&self) -> HRESULT;
            fn Unused19(&self) -> HRESULT;
            fn SetPersistedDefaultAudioEndpoint(&self, pid: u32, flow: EDataFlow, role: ERole, device: *mut c_void) -> HRESULT;
            fn GetPersistedDefaultAudioEndpoint(&self, pid: u32, flow: EDataFlow, role: ERole, device: *mut *mut c_void) -> HRESULT;
            fn ClearAllPersistedApplicationDefaultEndpoints(&self) -> HRESULT;
        }
    };
}

audio_policy_config_factory!(IAudioPolicyConfigFactory, "ab3d4648-e242-459f-b02f-541c70306324");
audio_policy_config_factory!(IAudioPolicyConfigFactoryLegacy, "2a59116d-6c4f-45e0-a74f-707e3fef9258");

/// Takes ownership of a raw HSTRING handle returned by the factory.
///
/// # Safety
/// `raw` must be null or an HSTRING the caller owns.
pub unsafe fn hstring_from_raw(raw: *mut c_void) -> HSTRING {
    // HSTRING is a transparent wrapper over the handle pointer (null = empty string).
    std::mem::transmute::<*mut c_void, HSTRING>(raw)
}

/// The raw handle of an HSTRING, for passing to a method declared with `*mut c_void` (the HSTRING keeps ownership).
pub fn hstring_as_raw(s: &HSTRING) -> *mut c_void {
    unsafe { std::mem::transmute_copy::<HSTRING, *mut c_void>(s) }
}

/// Makes sure the interface types are usable as generic `Interface`s (compile-time check only).
#[allow(dead_code)]
fn _assert_interfaces() {
    fn is<T: Interface>() {}
    is::<IPolicyConfig>();
    is::<IPolicyConfigVista>();
    is::<IAudioPolicyConfigFactory>();
    is::<IAudioPolicyConfigFactoryLegacy>();
    let _ = std::mem::size_of::<IUnknown_Vtbl>();
}

// The interface macro keeps methods private to this module, so the calls Waypoint makes are wrapped here. They're
// unsafe for the same reason the COM methods are: the pointers must be valid (a live string, a writable out slot).

pub unsafe fn set_default_endpoint_modern(p: &IPolicyConfig, id: PCWSTR, role: ERole) -> HRESULT {
    unsafe { p.SetDefaultEndpoint(id, role) }
}

pub unsafe fn set_default_endpoint_vista(p: &IPolicyConfigVista, id: PCWSTR, role: ERole) -> HRESULT {
    unsafe { p.SetDefaultEndpoint(id, role) }
}

pub unsafe fn get_app_endpoint_modern(f: &IAudioPolicyConfigFactory, pid: u32, flow: EDataFlow, role: ERole, out: *mut *mut c_void) -> HRESULT {
    unsafe { f.GetPersistedDefaultAudioEndpoint(pid, flow, role, out) }
}

pub unsafe fn get_app_endpoint_legacy(f: &IAudioPolicyConfigFactoryLegacy, pid: u32, flow: EDataFlow, role: ERole, out: *mut *mut c_void) -> HRESULT {
    unsafe { f.GetPersistedDefaultAudioEndpoint(pid, flow, role, out) }
}

pub unsafe fn set_app_endpoint_modern(f: &IAudioPolicyConfigFactory, pid: u32, flow: EDataFlow, role: ERole, device: *mut c_void) -> HRESULT {
    unsafe { f.SetPersistedDefaultAudioEndpoint(pid, flow, role, device) }
}

pub unsafe fn set_app_endpoint_legacy(f: &IAudioPolicyConfigFactoryLegacy, pid: u32, flow: EDataFlow, role: ERole, device: *mut c_void) -> HRESULT {
    unsafe { f.SetPersistedDefaultAudioEndpoint(pid, flow, role, device) }
}
