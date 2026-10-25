use super::OverlayLayout;
use webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2Controller;
use windows::Win32::{
    Foundation::{HWND, POINT, RECT},
    Graphics::Gdi::{
        CombineRgn, CreateRectRgn, DeleteObject, MapWindowPoints, SetWindowRgn, HRGN, RGN_DIFF,
    },
    UI::{Input::KeyboardAndMouse::EnableWindow, WindowsAndMessaging::GetClientRect},
};

struct Region(HRGN);

impl Drop for Region {
    fn drop(&mut self) {
        // SetWindowRgn owns a successful region; every untransferred region stays ours.
        unsafe {
            let _ = DeleteObject(self.0.into());
        }
    }
}

fn rectangle(left: i32, top: i32, right: i32, bottom: i32) -> Result<Region, String> {
    let handle = unsafe { CreateRectRgn(left, top, right, bottom) };
    if handle.is_invalid() {
        return Err("Could not allocate a browser clipping region.".into());
    }
    Ok(Region(handle))
}

fn clipped_region(
    size: &RECT,
    origin: POINT,
    scale: f64,
    layout: &OverlayLayout,
) -> Result<Region, String> {
    let region = rectangle(0, 0, size.right, size.bottom)?;
    for bounds in &layout.bounds {
        let left = (bounds.x * scale - f64::from(origin.x)).floor().max(0.0) as i32;
        let top = (bounds.y * scale - f64::from(origin.y)).floor().max(0.0) as i32;
        let right = ((bounds.x + bounds.width) * scale - f64::from(origin.x))
            .ceil()
            .min(f64::from(size.right)) as i32;
        let bottom = ((bounds.y + bounds.height) * scale - f64::from(origin.y))
            .ceil()
            .min(f64::from(size.bottom)) as i32;
        if left >= right || top >= bottom {
            continue;
        }
        let hole = rectangle(left, top, right, bottom)?;
        if unsafe { CombineRgn(Some(region.0), Some(region.0), Some(hole.0), RGN_DIFF) }.0 == 0 {
            return Err("Could not combine browser clipping regions.".into());
        }
    }
    Ok(region)
}

/// Clips browser pixels under overlays while retaining the live browser elsewhere.
pub fn apply(
    controller: &ICoreWebView2Controller,
    parent: isize,
    scale: f64,
    layout: &OverlayLayout,
) -> Result<(), String> {
    unsafe {
        let mut hwnd = HWND::default();
        controller
            .ParentWindow(&mut hwnd)
            .map_err(|error| error.to_string())?;
        apply_to_window(hwnd, HWND(parent as *mut _), scale, layout)
    }
}

fn apply_to_window(
    hwnd: HWND,
    parent: HWND,
    scale: f64,
    layout: &OverlayLayout,
) -> Result<(), String> {
    unsafe {
        let mut size = RECT::default();
        GetClientRect(hwnd, &mut size).map_err(|error| error.to_string())?;
        let mut origin = [POINT::default()];
        MapWindowPoints(Some(hwnd), Some(parent), &mut origin);
        if layout.bounds.is_empty() {
            if SetWindowRgn(hwnd, None, true) == 0 {
                return Err("Could not restore the browser's full region.".into());
            }
        } else {
            let region = clipped_region(&size, origin[0], scale, layout)?;
            if SetWindowRgn(hwnd, Some(region.0), true) == 0 {
                return Err("Could not apply the browser clipping region.".into());
            }
            std::mem::forget(region);
        }
        // Dialogs remain modal without removing the rendered browser beneath them.
        let _ = EnableWindow(hwnd, !layout.modal);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::guest::GuestBounds;
    use windows::{
        core::w,
        Win32::{
            Graphics::Gdi::{GetWindowRgn, PtInRegion},
            UI::{
                Input::KeyboardAndMouse::IsWindowEnabled,
                WindowsAndMessaging::{
                    CreateWindowExW, DestroyWindow, GetWindowLongPtrW, GWL_STYLE, WS_CHILD,
                    WS_POPUP, WS_VISIBLE,
                },
            },
        },
    };

    struct TestWindow(HWND);

    impl Drop for TestWindow {
        fn drop(&mut self) {
            unsafe {
                let _ = DestroyWindow(self.0);
            }
        }
    }

    #[test]
    fn clips_a_real_child_window_without_hiding_it_and_restores_modal_input() {
        unsafe {
            // The parent stays hidden; this test never opens a visible desktop window.
            let parent = TestWindow(
                CreateWindowExW(
                    Default::default(),
                    w!("STATIC"),
                    w!(""),
                    WS_POPUP,
                    0,
                    0,
                    800,
                    600,
                    None,
                    None,
                    None,
                    None,
                )
                .unwrap(),
            );
            let child = TestWindow(
                CreateWindowExW(
                    Default::default(),
                    w!("STATIC"),
                    w!(""),
                    WS_CHILD | WS_VISIBLE,
                    100,
                    50,
                    600,
                    500,
                    Some(parent.0),
                    None,
                    None,
                    None,
                )
                .unwrap(),
            );
            let layout = OverlayLayout {
                bounds: vec![GuestBounds {
                    x: 200.0,
                    y: 100.0,
                    width: 100.0,
                    height: 100.0,
                }],
                modal: true,
            };
            apply_to_window(child.0, parent.0, 1.0, &layout).unwrap();
            let actual = rectangle(0, 0, 0, 0).unwrap();
            assert_ne!(GetWindowRgn(child.0, actual.0).0, 0);
            assert!(PtInRegion(actual.0, 20, 20).as_bool());
            assert!(!PtInRegion(actual.0, 120, 70).as_bool());
            assert_ne!(
                GetWindowLongPtrW(child.0, GWL_STYLE) as u32 & WS_VISIBLE.0,
                0
            );
            assert!(!IsWindowEnabled(child.0).as_bool());

            apply_to_window(child.0, parent.0, 1.0, &OverlayLayout::default()).unwrap();
            assert_eq!(GetWindowRgn(child.0, actual.0).0, 0);
            assert!(IsWindowEnabled(child.0).as_bool());
            assert_ne!(
                GetWindowLongPtrW(child.0, GWL_STYLE) as u32 & WS_VISIBLE.0,
                0
            );
        }
    }

    #[test]
    fn clips_only_the_overlay_at_scaled_window_coordinates() {
        let layout = OverlayLayout {
            bounds: vec![GuestBounds {
                x: 500.0,
                y: 50.0,
                width: 200.0,
                height: 100.0,
            }],
            modal: false,
        };
        let size = RECT {
            right: 600,
            bottom: 900,
            ..Default::default()
        };
        let region = clipped_region(&size, POINT { x: 600, y: 75 }, 1.5, &layout).unwrap();
        unsafe {
            assert!(PtInRegion(region.0, 100, 50).as_bool());
            assert!(!PtInRegion(region.0, 200, 50).as_bool());
            assert!(PtInRegion(region.0, 200, 200).as_bool());
        }
    }

    #[test]
    fn ignores_overlays_outside_the_browser_and_restores_empty_layouts() {
        let size = RECT {
            right: 600,
            bottom: 900,
            ..Default::default()
        };
        let region =
            clipped_region(&size, POINT::default(), 1.0, &OverlayLayout::default()).unwrap();
        unsafe {
            assert!(PtInRegion(region.0, 500, 800).as_bool());
        }
        let layout = OverlayLayout {
            bounds: vec![GuestBounds {
                x: -200.0,
                y: 0.0,
                width: 100.0,
                height: 100.0,
            }],
            modal: true,
        };
        let region = clipped_region(&size, POINT::default(), 1.0, &layout).unwrap();
        unsafe {
            assert!(PtInRegion(region.0, 50, 50).as_bool());
        }
    }
}
