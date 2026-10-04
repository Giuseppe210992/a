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

    /// Copies `len` bytes at `offset` (None if out of range).
    pub fn read_at(&self, offset: usize, len: usize) -> Option<Vec<u8>> {
        if offset.checked_add(len)? > self.len {
            return None;
        }
        let mut v = vec![0u8; len];
        unsafe { ptr::copy_nonoverlapping(self.base.add(offset), v.as_mut_ptr(), len) };
        Some(v)
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

/// A mapping that is opened on demand and retried at most twice a second while the simulator
/// is not running (OpenFileMapping on every 4 ms poll would be wasteful).
pub struct LazyMapping {
    name: &'static str,
    map: Option<Mapping>,
    last_try: Option<std::time::Instant>,
}

impl LazyMapping {
    pub fn new(name: &'static str) -> Self {
        Self { name, map: None, last_try: None }
    }

    fn ensure(&mut self) {
        if self.map.is_none() && self.last_try.is_none_or(|t| t.elapsed() >= std::time::Duration::from_millis(500)) {
            self.last_try = Some(std::time::Instant::now());
            self.map = Mapping::open(self.name);
        }
    }

    pub fn bytes(&mut self) -> Option<Vec<u8>> {
        self.ensure();
        self.map.as_ref().map(|m| m.to_vec())
    }

    pub fn read_at(&mut self, offset: usize, len: usize) -> Option<Vec<u8>> {
        self.ensure();
        self.map.as_ref().and_then(|m| m.read_at(offset, len))
    }
}
