mod commands;
mod lifecycle;
#[cfg(feature = "app-proof")]
mod proof;
mod state;
use state::DesktopState;
use std::sync::Arc;
use tauri::Manager;

fn begin_exit(app: &tauri::AppHandle) {
    let state = app.state::<Arc<DesktopState>>().inner().clone();
    if state.close() {
        let app = app.clone();
        tauri::async_runtime::spawn(async move {
            state.shutdown().await;
            app.exit(0);
        });
    }
}
pub fn run() {
    let args: Vec<_> = std::env::args_os().skip(1).collect();
    #[cfg(feature = "app-proof")]
    if !args.is_empty() {
        proof::run(args);
        return;
    }
    if !args.is_empty() {
        eprintln!("unsupported_arguments");
        std::process::exit(1);
    }
    let app = tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            commands::prepare_desktop,
            commands::inspect_setup,
            commands::configure_setup,
            commands::replace_credentials,
            commands::start_service,
            commands::stop_service,
            commands::repair_service,
            commands::open_token_page
        ])
        .setup(|app| {
            app.manage(Arc::new(DesktopState::new(
                app.path().resource_dir()?.join("runtime"),
            )));
            tauri::WebviewWindowBuilder::new(
                app,
                "main",
                tauri::WebviewUrl::App("index.html".into()),
            )
            .title("insto")
            .inner_size(780.0, 820.0)
            .min_inner_size(360.0, 540.0)
            .on_navigation(local_navigation)
            .on_new_window(|_, _| tauri::webview::NewWindowResponse::Deny)
            .build()?;
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                begin_exit(window.app_handle());
            }
        })
        .build(tauri::generate_context!());
    let Ok(app) = app else {
        eprintln!("application_start_failed");
        return;
    };
    app.run(|app, event| {
        if let tauri::RunEvent::ExitRequested { api, .. } = event {
            if !app.state::<Arc<DesktopState>>().drained() {
                api.prevent_exit();
                begin_exit(app);
            }
        }
    });
}
fn local_navigation(url: &tauri::Url) -> bool {
    url.scheme() == "tauri"
        && url.host_str() == Some("localhost")
        && url.username().is_empty()
        && url.password().is_none()
        && url.port().is_none()
}
#[cfg(test)]
mod tests;
