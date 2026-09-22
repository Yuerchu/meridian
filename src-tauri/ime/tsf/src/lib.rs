//! Meridian 输入法的 TSF 文本服务。Windows 之外这是一个空库，只为让工作区在每个平台上都能编译。
#[cfg(windows)]
pub mod client;
#[cfg(windows)]
pub mod com;
