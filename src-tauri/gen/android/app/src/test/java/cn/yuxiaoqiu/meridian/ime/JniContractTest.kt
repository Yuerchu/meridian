package cn.yuxiaoqiu.meridian.ime

import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * Every `external fun` the keyboard declares has its `Java_*` symbol in the
 * library, and the other way round. A name that differs compiles on both sides
 * and fails only on the device, as an UnsatisfiedLinkError the engine wrapper
 * catches — the keyboard quietly falls back to typing plain characters, or,
 * for `nativeIsPrivate`, to the field's own word on privacy.
 */
class JniContractTest {
  @Test
  fun everyDeclaredNativeFunctionIsExportedAndNothingElseIs() {
    val rust = rustFile("ime/android/src/jni.rs").readText()
    val exported = Regex("""Java_cn_yuxiaoqiu_meridian_ime_EngineBridge_(native\w+)""")
      .findAll(rust).map { it.groupValues[1] }.toSortedSet()
    val kotlin = rustFile("gen/android/app/src/main/java/cn/yuxiaoqiu/meridian/ime/Engine.kt").readText()
    val declared = Regex("""external fun (native\w+)""").findAll(kotlin).map { it.groupValues[1] }.toSortedSet()
    assertEquals(declared, exported)
  }
}
