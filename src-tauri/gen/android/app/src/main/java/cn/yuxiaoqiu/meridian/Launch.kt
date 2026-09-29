package cn.yuxiaoqiu.meridian

/**
 * An extra on the intent that opens Meridian, naming a settings page to open
 * it on. The keyboard's toolbar sends `ime`; `MainActivity` hands it to the
 * front end. A string rather than a class reference, because the keyboard
 * runs in `:ime` and must not load anything of the app's.
 */
const val EXTRA_OPEN_SETTINGS = "cn.yuxiaoqiu.meridian.OPEN_SETTINGS"
