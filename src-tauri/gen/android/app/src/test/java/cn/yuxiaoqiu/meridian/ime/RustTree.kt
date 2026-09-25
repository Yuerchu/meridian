package cn.yuxiaoqiu.meridian.ime

import java.io.File

/** A file under `src-tauri/`, found by walking up from where the tests run. */
fun rustFile(path: String): File {
  var dir: File? = File(System.getProperty("user.dir")).absoluteFile
  while (dir != null) {
    val candidate = File(dir, path)
    if (candidate.exists()) return candidate
    dir = dir.parentFile
  }
  error("$path not found above ${System.getProperty("user.dir")}")
}
