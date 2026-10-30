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

            // 根据显示器实际可用工作区（排除了 Windows 任务栏 / macOS Dock 与菜单栏）动态自适应最佳长宽
            if let Ok(Some(monitor)) = main_window.current_monitor() {
                let scale_factor = monitor.scale_factor();
                let work_area = monitor.work_area();
                let work_w = work_area.size.width as f64 / scale_factor;
                let work_h = work_area.size.height as f64 / scale_factor;

                // 高度不超过工作区实际可用高度的 85%（保证上下留出呼吸空间，绝不被任务栏/Dock遮挡或顶死上边框）
                // 宽度不超过可用宽度的 88%
                let max_w = (work_w * 0.88).max(900.0);
                let max_h = (work_h * 0.85).max(560.0);

                let target_w = 1280.0_f64.min(max_w);
                let target_h = 840.0_f64.min(max_h);

                let _ = main_window.set_size(tauri::Size::Logical(tauri::LogicalSize::new(target_w, target_h)));
                let _ = main_window.center();
            }

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
