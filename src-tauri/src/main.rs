#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::net::TcpStream;
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;
use tauri::Manager;
use tauri_plugin_shell::ShellExt;

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            let shell = app.shell();

            // 启动伴生后端服务 (Sidecar)
            let (_rx, child) = shell
                .sidecar("server")
                .expect("failed to setup server sidecar")
                .spawn()
                .expect("failed to spawn server sidecar");

            let child_arc = Arc::new(Mutex::new(Some(child)));
            let child_for_close = child_arc.clone();

            let main_window = app.get_webview_window("main").expect("failed to get main window");

            // 监听窗口关闭事件，保证随应用关闭彻底退出后台后端进程
            main_window.on_window_event(move |event| {
                if let tauri::WindowEvent::CloseRequested { .. } = event {
                    if let Ok(mut lock) = child_for_close.lock() {
                        if let Some(c) = lock.take() {
                            let _ = c.kill();
                        }
                    }
                }
            });

            // 后台线程检测后端 43124 就绪后，将窗口导航至看板主页
            let win = main_window.clone();
            thread::spawn(move || {
                for _ in 0..60 {
                    thread::sleep(Duration::from_millis(250));
                    if TcpStream::connect("127.0.0.1:43124").is_ok() {
                        let _ = win.navigate(tauri::Url::parse("http://127.0.0.1:43124").unwrap());
                        break;
                    }
                }
            });

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
