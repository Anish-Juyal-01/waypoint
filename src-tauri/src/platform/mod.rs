//! Windows integrations around the engine: the sign-in task, the Start menu shortcut, and the native thread for
//! hotkeys, power/theme broadcasts and the on-screen indicator.

pub mod native;
pub mod shortcut;
pub mod startup;
