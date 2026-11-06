// Bezels desktop: system-webview window on the local UI + global shortcuts.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::io::{Read, Write};
use std::net::TcpStream;
use std::process::{Child, Command};
use std::time::Duration;
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

const PORT: u16 = 4477;

/// Minimal HTTP/1.1 POST to the local daemon (no HTTP client crate needed).
fn rpc(method: &str) -> Result<String, String> {
    let body = format!(r#"{{"method":"{method}","params":{{}}}}"#);
    let mut s = TcpStream::connect(("127.0.0.1", PORT)).map_err(|e| e.to_string())?;
    s.set_read_timeout(Some(Duration::from_secs(30))).ok();
    let req = format!(
        "POST /rpc HTTP/1.1\r\nHost: 127.0.0.1:{PORT}\r\nContent-Type: application/json\r\nX-Bezels-Source: ui\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    );
    s.write_all(req.as_bytes()).map_err(|e| e.to_string())?;
    let mut out = String::new();
    s.read_to_string(&mut out).map_err(|e| e.to_string())?;
    Ok(out)
}

fn daemon_up() -> bool { TcpStream::connect_timeout(&([127, 0, 0, 1], PORT).into(), Duration::from_millis(300)).is_ok() }

fn start_daemon() -> Option<Child> {
    if daemon_up() { return None; }
    let cli = std::env::var("BEZELS_CLI").unwrap_or_else(|_| "../../dist/cli.js".into());
    let child = Command::new("node").args([cli.as_str(), "serve"]).spawn().ok();
    for _ in 0..50 { if daemon_up() { break; } std::thread::sleep(Duration::from_millis(100)); }
    child
}

fn main() {
    let mut daemon = start_daemon();
    let copy = Shortcut::new(Some(Modifiers::CONTROL | Modifiers::ALT), Code::KeyC);
    tauri::Builder::default()
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(move |_app, sc, ev| {
                    if ev.state() == ShortcutState::Pressed && sc == &copy {
                        std::thread::spawn(|| { let _ = rpc("copy_focused"); });
                    }
                })
                .build(),
        )
        .setup(move |app| { app.global_shortcut().register(copy)?; Ok(()) })
        .run(tauri::generate_context!())
        .expect("error while running Bezels desktop");
    if let Some(c) = daemon.as_mut() { let _ = c.kill(); }
}
