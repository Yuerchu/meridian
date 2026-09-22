//! The class factory `DllGetClassObject` hands out.

use windows::Win32::System::Com::{IClassFactory, IClassFactory_Impl};
use windows_core::BOOL;
use windows_core::{GUID, IUnknown, Interface, Ref, Result, implement};

use super::service::TextService;

#[implement(IClassFactory)]
pub struct ClassFactory;

impl IClassFactory_Impl for ClassFactory_Impl {
    fn CreateInstance(
        &self,
        _outer: Ref<'_, IUnknown>,
        riid: *const GUID,
        ppv: *mut *mut core::ffi::c_void,
    ) -> Result<()> {
        let unknown: IUnknown = TextService::new().into();
        // SAFETY: COM passes valid `riid`/`ppv` for the call; `query` writes
        // through `ppv` only on success.
        unsafe { unknown.query(riid, ppv).ok() }
    }

    fn LockServer(&self, _lock: BOOL) -> Result<()> {
        Ok(())
    }
}
