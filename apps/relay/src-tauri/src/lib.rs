//! 接口中继 as a desktop app: the window edits the config (relay-core's edit), which is saved
//! at once; the server runs from launch until the app quits. Closing the window keeps it running
//! (the tray icon brings the window back, and quits). Opening the app again shows the running one.

use relay_core::config::{self, AuthStyle, Config, Protocol};
use relay_core::edit::{EditError, UpstreamFields};
use relay_core::proxy::{self, Relay};
use relay_core::view::{self, Server, View};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager, State, WindowEvent};
use tokio::sync::oneshot;

struct App {
    relay: Arc<Relay>,
    /// Where the config is saved (the system's app config folder).
    path: PathBuf,
    server: Mutex<Server>,
    stop: Mutex<Option<oneshot::Sender<()>>>,
    /// Counts server starts: only the latest one sets the state.
    starts: AtomicU64,
    config_error: Mutex<Option<String>>,
}

impl App {
    fn new(path: PathBuf, config: Config, error: Option<String>) -> Arc<App> {
        let port = config.port;
        Arc::new(App {
            relay: Relay::new(config),
            path,
            server: Mutex::new(Server::Starting { port }),
            stop: Mutex::new(None),
            starts: AtomicU64::new(0),
            config_error: Mutex::new(error),
        })
    }

    async fn view(&self) -> View {
        let config = self.relay.config.read().await;
        let log = self.relay.log.lock().expect("the log lock");
        view::view(
            &config,
            &log,
            self.server.lock().expect("the server lock").clone(),
            self.config_error.lock().expect("lock").clone(),
        )
    }

    /// Edits a copy of the config, saves it, and only then uses it: a change that can't be saved
    /// isn't made.
    async fn change(
        &self,
        f: impl FnOnce(&mut Config) -> Result<(), EditError>,
    ) -> Result<View, String> {
        {
            let mut current = self.relay.config.write().await;
            let mut next = current.clone();
            f(&mut next).map_err(|e| e.to_string())?;
            config::save(&self.path, &next).map_err(|e| e.to_string())?;
            *current = next;
        }
        Ok(self.view().await)
    }
}

/// (Re)starts the server on `port`. The port isn't changed by itself when it is taken: the
/// clients are set up with it, so the window says so instead.
fn start_server(app: Arc<App>, port: u16) {
    let n = app.starts.fetch_add(1, Ordering::SeqCst) + 1;
    if let Some(stop) = app.stop.lock().expect("lock").take() {
        let _ = stop.send(());
    }
    *app.server.lock().expect("lock") = Server::Starting { port };
    tauri::async_runtime::spawn(async move {
        // The one just stopped may take a moment to let go of the port.
        let mut tries = 0;
        let bound = loop {
            match proxy::bind(port).await {
                Ok(l) => break Ok(l),
                Err(_) if tries < 10 => {
                    tries += 1;
                    tokio::time::sleep(Duration::from_millis(100)).await;
                }
                Err(e) => break Err(e),
            }
        };
        if app.starts.load(Ordering::SeqCst) != n {
            return;
        }
        match bound {
            Ok(listener) => {
                let (tx, rx) = oneshot::channel();
                *app.stop.lock().expect("lock") = Some(tx);
                *app.server.lock().expect("lock") = Server::Running {
                    address: format!("http://127.0.0.1:{port}"),
                };
                let result = proxy::serve(listener, app.relay.clone(), async {
                    let _ = rx.await;
                })
                .await;
                if let Err(e) = result {
                    if app.starts.load(Ordering::SeqCst) == n {
                        *app.server.lock().expect("lock") = Server::Failed {
                            port,
                            error: e.to_string(),
                        };
                    }
                }
            }
            Err(e) => {
                let error = if e.kind() == std::io::ErrorKind::AddrInUse {
                    format!("端口 {port} 已被其他程序占用")
                } else {
                    e.to_string()
                };
                *app.server.lock().expect("lock") = Server::Failed { port, error };
            }
        }
    });
}

/// An upstream as the window sends it; `key` absent keeps the saved one.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct UpstreamInput {
    name: String,
    base_url: String,
    key: Option<String>,
    auth: AuthStyle,
    enabled: bool,
    system_proxy: bool,
}

impl From<UpstreamInput> for UpstreamFields {
    fn from(u: UpstreamInput) -> Self {
        UpstreamFields {
            name: u.name,
            base_url: u.base_url,
            key: u.key,
            auth: u.auth,
            enabled: u.enabled,
            system_proxy: u.system_proxy,
        }
    }
}

type Shared<'a> = State<'a, Arc<App>>;

#[tauri::command]
async fn state(app: Shared<'_>) -> Result<View, String> {
    Ok(app.view().await)
}

#[tauri::command]
async fn add_route(app: Shared<'_>, name: String, protocol: Protocol) -> Result<View, String> {
    app.change(|c| c.add_route(&name, protocol).map(|_| ()))
        .await
}

#[tauri::command]
async fn rename_route(app: Shared<'_>, id: String, name: String) -> Result<View, String> {
    app.change(|c| c.rename_route(&id, &name)).await
}

#[tauri::command]
async fn delete_route(app: Shared<'_>, id: String) -> Result<View, String> {
    app.change(|c| c.delete_route(&id)).await
}

#[tauri::command]
async fn add_upstream(
    app: Shared<'_>,
    route: String,
    upstream: UpstreamInput,
) -> Result<View, String> {
    app.change(|c| c.add_upstream(&route, upstream.into()).map(|_| ()))
        .await
}

#[tauri::command]
async fn update_upstream(
    app: Shared<'_>,
    route: String,
    id: String,
    upstream: UpstreamInput,
) -> Result<View, String> {
    app.change(|c| c.update_upstream(&route, &id, upstream.into()))
        .await
}

#[tauri::command]
async fn move_upstream(
    app: Shared<'_>,
    route: String,
    id: String,
    by: i32,
) -> Result<View, String> {
    app.change(|c| c.move_upstream(&route, &id, by)).await
}

#[tauri::command]
async fn delete_upstream(app: Shared<'_>, route: String, id: String) -> Result<View, String> {
    app.change(|c| c.delete_upstream(&route, &id)).await
}

#[derive(Serialize)]
struct NewToken {
    view: View,
    /// The token's text: shown once, only its hash is kept.
    token: String,
}

#[tauri::command]
async fn add_token(app: Shared<'_>, route: String, name: String) -> Result<NewToken, String> {
    let mut token = String::new();
    let view = app
        .change(|c| {
            token = c.add_token(&route, &name, config::now())?;
            Ok(())
        })
        .await?;
    Ok(NewToken { view, token })
}

#[tauri::command]
async fn set_token_enabled(
    app: Shared<'_>,
    route: String,
    id: String,
    enabled: bool,
) -> Result<View, String> {
    app.change(|c| c.set_token_enabled(&route, &id, enabled))
        .await
}

#[tauri::command]
async fn delete_token(app: Shared<'_>, route: String, id: String) -> Result<View, String> {
    app.change(|c| c.delete_token(&route, &id)).await
}

#[tauri::command]
async fn set_port(app: Shared<'_>, port: u16) -> Result<View, String> {
    app.change(|c| c.set_port(port)).await?;
    start_server(app.inner().clone(), port);
    Ok(app.view().await)
}

/// The window's commands (also for the tests below).
macro_rules! commands {
    () => {
        tauri::generate_handler![
            state,
            add_route,
            rename_route,
            delete_route,
            add_upstream,
            update_upstream,
            move_upstream,
            delete_upstream,
            add_token,
            set_token_enabled,
            delete_token,
            set_port
        ]
    };
}

/// The app's config and permissions (tauri.conf.json, capabilities/), made once: on macOS it
/// embeds the Info.plist, which can be done only once per binary (the app and its tests use this).
fn context<R: tauri::Runtime>() -> tauri::Context<R> {
    tauri::generate_context!()
}

fn show_window(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
}

pub fn run() {
    tauri::Builder::default()
        // First: a second launch shows this one's window instead of fighting it for the port.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            show_window(app)
        }))
        .setup(|app| {
            let path = app.path().app_config_dir()?.join("config.json");
            let (config, error) = config::load(&path);
            let port = config.port;
            let state = App::new(path, config, error.map(|e| e.to_string()));
            app.manage(state.clone());
            start_server(state, port);

            let show = MenuItem::with_id(app, "show", "打开接口中继", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &quit])?;
            let mut tray = TrayIconBuilder::with_id("main")
                .tooltip("接口中继")
                .menu(&menu)
                .show_menu_on_left_click(false);
            if let Some(icon) = app.default_window_icon() {
                tray = tray.icon(icon.clone());
            }
            tray.on_menu_event(|app, e| match e.id.as_ref() {
                "show" => show_window(app),
                "quit" => app.exit(0),
                _ => {}
            })
            .on_tray_icon_event(|tray, e| {
                if let TrayIconEvent::Click {
                    button: MouseButton::Left,
                    button_state: MouseButtonState::Up,
                    ..
                } = e
                {
                    show_window(tray.app_handle());
                }
            })
            .build(app)?;
            Ok(())
        })
        // Closing the window keeps the relay running; the tray brings it back or quits.
        .on_window_event(|w, e| {
            if let WindowEvent::CloseRequested { api, .. } = e {
                let _ = w.hide();
                api.prevent_close();
            }
        })
        .invoke_handler(commands!())
        .build(context())
        .expect("the app starts")
        .run(|app, e| {
            // macOS: the Dock icon clicked while the window is hidden.
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Reopen { .. } = e {
                show_window(app);
            }
            #[cfg(not(target_os = "macos"))]
            let _ = (app, e);
        });
}

/// The commands called as the window calls them (the same argument names and JSON shapes as
/// src/api.ts), on a mock runtime: what they return, and what is saved.
#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{json, Value};
    use tauri::ipc::{CallbackFn, InvokeBody};
    use tauri::test::{get_ipc_response, mock_builder, INVOKE_KEY};
    use tauri::webview::InvokeRequest;

    fn call(
        w: &tauri::WebviewWindow<tauri::test::MockRuntime>,
        cmd: &str,
        args: Value,
    ) -> Result<Value, Value> {
        let req = InvokeRequest {
            cmd: cmd.into(),
            callback: CallbackFn(0),
            error: CallbackFn(1),
            url: if cfg!(windows) {
                "http://tauri.localhost"
            } else {
                "tauri://localhost"
            }
            .parse()
            .unwrap(),
            body: InvokeBody::Json(args),
            headers: Default::default(),
            invoke_key: INVOKE_KEY.to_string(),
        };
        get_ipc_response(w, req).map(|b| b.deserialize::<Value>().unwrap())
    }

    #[test]
    fn the_windows_calls_reach_the_commands_and_are_saved() {
        let dir = std::env::temp_dir().join(format!("relay-app-test-{}", std::process::id()));
        let path = dir.join("config.json");
        let state = App::new(path.clone(), Config::default(), None);
        // The app's own context: its config and permissions (capabilities/default.json), as shipped.
        let app = mock_builder()
            .invoke_handler(commands!())
            .manage(state)
            .build(context())
            .unwrap();
        let w = tauri::WebviewWindowBuilder::new(&app, "main", Default::default())
            .build()
            .unwrap();

        let v = call(
            &w,
            "add_route",
            json!({ "name": "主线", "protocol": "anthropic" }),
        )
        .unwrap();
        let route = v["routes"][0]["id"].as_str().unwrap().to_string();
        assert_eq!(v["routes"][0]["protocol"], "anthropic");
        let v = call(&w, "add_upstream", json!({ "route": route, "upstream": { "name": "U", "baseUrl": "https://x.example/api", "key": "sk-secret-000000000", "auth": "bearer", "enabled": true, "systemProxy": true } })).unwrap();
        let up = &v["routes"][0]["upstreams"][0];
        assert_eq!(
            (
                up["baseUrl"].as_str(),
                up["auth"].as_str(),
                up["systemProxy"].as_bool()
            ),
            (Some("https://x.example/api"), Some("bearer"), Some(true))
        );
        assert_eq!(up["keyHint"], "sk-s…0000");
        let up_id = up["id"].as_str().unwrap().to_string();
        // Changed without a key: the saved key stays.
        call(&w, "update_upstream", json!({ "route": route, "id": up_id, "upstream": { "name": "U2", "baseUrl": "https://x.example", "auth": "x-api-key", "enabled": false, "systemProxy": false } })).unwrap();
        call(
            &w,
            "move_upstream",
            json!({ "route": route, "id": up_id, "by": -1 }),
        )
        .unwrap();
        let t = call(&w, "add_token", json!({ "route": route, "name": "ye" })).unwrap();
        let token = t["token"].as_str().unwrap().to_string();
        let token_id = t["view"]["routes"][0]["tokens"][0]["id"]
            .as_str()
            .unwrap()
            .to_string();
        call(
            &w,
            "set_token_enabled",
            json!({ "route": route, "id": token_id, "enabled": false }),
        )
        .unwrap();
        call(&w, "rename_route", json!({ "id": route, "name": "备线" })).unwrap();
        // A wrong value: the reason comes back as the error, nothing changes.
        assert_eq!(
            call(
                &w,
                "add_upstream",
                json!({ "route": route, "upstream": { "name": "V", "baseUrl": "x.example", "key": "k", "auth": "bearer", "enabled": true, "systemProxy": false } })
            ),
            Err(json!("地址需以 http:// 或 https:// 开头"))
        );
        assert_eq!(
            call(&w, "set_port", json!({ "port": 80 })),
            Err(json!("端口需在 1024 到 65535 之间"))
        );

        let (saved, err) = config::load(&path);
        assert!(err.is_none());
        let r = &saved.routes[0];
        assert_eq!(r.name, "备线");
        assert_eq!(
            (
                r.upstreams[0].name.as_str(),
                r.upstreams[0].key.as_str(),
                r.upstreams[0].auth,
                r.upstreams[0].enabled
            ),
            ("U2", "sk-secret-000000000", AuthStyle::XApiKey, false)
        );
        assert!(!r.tokens[0].enabled);
        assert_eq!(r.tokens[0].hash, config::hash_token(&token));
        assert!(!std::fs::read_to_string(&path).unwrap().contains(&token));
        // What the window reads: no key, no token.
        let v = call(&w, "state", json!({})).unwrap().to_string();
        assert!(!v.contains("sk-secret") && !v.contains(&token), "{v}");

        call(
            &w,
            "delete_token",
            json!({ "route": route, "id": token_id }),
        )
        .unwrap();
        call(
            &w,
            "delete_upstream",
            json!({ "route": route, "id": up_id }),
        )
        .unwrap();
        let v = call(&w, "delete_route", json!({ "id": route })).unwrap();
        assert_eq!(v["routes"], json!([]));
        let _ = std::fs::remove_dir_all(dir);
    }
}
