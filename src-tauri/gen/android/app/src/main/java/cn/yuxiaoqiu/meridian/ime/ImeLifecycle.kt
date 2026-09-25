package cn.yuxiaoqiu.meridian.ime

import android.view.View
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.LifecycleRegistry
import androidx.lifecycle.ViewModelStore
import androidx.lifecycle.ViewModelStoreOwner
import androidx.lifecycle.setViewTreeLifecycleOwner
import androidx.lifecycle.setViewTreeViewModelStoreOwner
import androidx.savedstate.SavedStateRegistry
import androidx.savedstate.SavedStateRegistryController
import androidx.savedstate.SavedStateRegistryOwner
import androidx.savedstate.setViewTreeSavedStateRegistryOwner

/**
 * What a ComposeView needs from its window and an InputMethodService does not
 * provide: a lifecycle, a view-model store and a saved-state registry. An
 * activity would be all three; here they follow the service — created with
 * it, resumed while the keyboard is on screen, destroyed with it.
 */
class ImeLifecycle : LifecycleOwner, ViewModelStoreOwner, SavedStateRegistryOwner {
  private val registry = LifecycleRegistry(this)
  private val store = ViewModelStore()
  private val savedState = SavedStateRegistryController.create(this)

  override val lifecycle: Lifecycle get() = registry
  override val viewModelStore: ViewModelStore get() = store
  override val savedStateRegistry: SavedStateRegistry get() = savedState.savedStateRegistry

  fun create() {
    savedState.performRestore(null)
    registry.handleLifecycleEvent(Lifecycle.Event.ON_CREATE)
  }

  fun shown() {
    registry.handleLifecycleEvent(Lifecycle.Event.ON_RESUME)
  }

  fun hidden() {
    if (registry.currentState.isAtLeast(Lifecycle.State.RESUMED)) {
      registry.handleLifecycleEvent(Lifecycle.Event.ON_PAUSE)
    }
  }

  fun destroy() {
    registry.handleLifecycleEvent(Lifecycle.Event.ON_DESTROY)
    store.clear()
  }

  /** Composition looks these up from the view tree, so both the window's root and the view carry them. */
  fun attach(vararg views: View) {
    for (view in views) {
      view.setViewTreeLifecycleOwner(this)
      view.setViewTreeViewModelStoreOwner(this)
      view.setViewTreeSavedStateRegistryOwner(this)
    }
  }
}
