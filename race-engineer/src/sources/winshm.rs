//! Read-only named shared-memory mapping (Windows only).

use std::ptr;
use windows_sys::Win32::Foundation::{CloseHandle, HANDLE};
use windows_sys::Win32::System::Memory::{
    MapViewOfFile, OpenFileMappingW, UnmapViewOfFile, VirtualQuery, FILE_MAP_READ,
    MEMORY_BASIC_INFORMATION,
};

pub struct Mapping {
    handle: HANDLE,
    base: *const u8,
    len: usize,
}

// The mapping is read-only and the pointer is only dereferenced through `to_vec`.
unsafe impl Send for Mapping {}

impl Mapping {
    /// Opens an existing mapping created by the simulator; `None` if the sim is not running.
    pub fn open(name: &str) -> Option<Self> {
        let wide: Vec<u16> = name.encode_utf16().chain(std::iter::once(0)).collect();
        unsafe {
            let handle = OpenFileMappingW(FILE_MAP_READ, 0, wide.as_ptr());
            if handle.is_null() {
                return None;
            }
            let view = MapViewOfFile(handle, FILE_MAP_READ, 0, 0, 0);
            if view.Value.is_null() {
                CloseHandle(handle);
                return None;
            }
            let mut info: MEMORY_BASIC_INFORMATION = std::mem::zeroed();
            let n = VirtualQuery(view.Value, &mut info, std::mem::size_of::<MEMORY_BASIC_INFORMATION>());
            if n == 0 || info.RegionSize == 0 {
                UnmapViewOfFile(view);
                CloseHandle(handle);
                return None;
            }
            Some(Self { handle, base: view.Value as *const u8, len: info.RegionSize })
        }
    }

    pub fn len(&self) -> usize {
        self.len
    }

    pub fn is_empty(&self) -> bool {
        self.len == 0
    }

    /// Copies the current contents. Tearing is possible by design of the simulators'
    /// protocols; callers validate with the sim's own counters (tick / packetId).
    pub fn to_vec(&self) -> Vec<u8> {
        let mut v = vec![0u8; self.len];
        unsafe { ptr::copy_nonoverlapping(self.base, v.as_mut_ptr(), self.len) };
        v
    }
}

impl Drop for Mapping {
    fn drop(&mut self) {
        unsafe {
            UnmapViewOfFile(windows_sys::Win32::System::Memory::MEMORY_MAPPED_VIEW_ADDRESS {
                Value: self.base as *mut _,
            });
            CloseHandle(self.handle);
        }
    }
}
