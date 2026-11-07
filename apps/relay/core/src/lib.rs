//! The relay without its window: the config, the server and its log. The desktop app
//! (src-tauri) starts the server with the saved config and edits the config.

pub mod config;
pub mod edit;
pub mod log;
pub mod proxy;
pub mod view;
