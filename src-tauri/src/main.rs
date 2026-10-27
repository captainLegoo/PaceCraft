#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::net::TcpStream;
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;
use tauri::Manager;
use tauri_plugin_shell::ShellExt;

fn main() {
    let sidecar_child = Arc::new(Mutex::new(None));
    let sidecar_for_setup = sidecar_child.clone();
    let sidecar_for_exit = sidecar_child.clone();

    let app = tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(move |app| {
            let shell = app.shell();

            // 启动伴生后端服务 (Sidecar)
            let (_rx, child) = shell
                .sidecar("server")
                .expect("failed to setup server sidecar")
                .spawn()
                .expect("failed to spawn server sidecar");

            if let Ok(mut lock) = sidecar_for_setup.lock() {
                *lock = Some(child);
            }

            let sidecar_for_close = sidecar_child.clone();
            let main_window = app.get_webview_window("main").expect("failed to get main window");

            // 监听窗口关闭事件，保证随应用关闭退出后台后端进程
            main_window.on_window_event(move |event| {
                if let tauri::WindowEvent::CloseRequested { .. } = event {
                    if let Ok(mut lock) = sidecar_for_close.lock() {
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
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    // 全局退出事件（包括 relaunch 重启）彻底终结伴生后端进程，防止 43124 端口冲突
    app.run(move |_app_handle, event| {
        if let tauri::RunEvent::Exit = event {
            if let Ok(mut lock) = sidecar_for_exit.lock() {
                if let Some(c) = lock.take() {
                    let _ = c.kill();
                }
            }
        }
    });
}
