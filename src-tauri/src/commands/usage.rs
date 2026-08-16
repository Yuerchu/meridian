use tauri::Manager;

use crate::db::ops::usage::{report, UsageBucket, UsageDimension, UsageFilter};
use crate::AppDb;

/// What was spent, grouped by one thing.
///
/// One command with a dimension rather than one per breakdown: the five
/// groupings and the two time series produce the same shape and differ only in
/// the key, and splitting them would make "the parts add up to the whole" a
/// coincidence between seven functions instead of a property of one.
///
/// `UsageDimension::Total` is how a caller asks for the headline figures. It is
/// the same query with a constant key, which is what stops a summary and the
/// breakdown beneath it from being computed two different ways.
#[tauri::command]
pub async fn usage_report(
    app: tauri::AppHandle,
    dimension: UsageDimension,
    filter: Option<UsageFilter>,
) -> Result<Vec<UsageBucket>, String> {
    let pool = app.state::<AppDb>().0.clone();
    let filter = filter.unwrap_or_default();
    tokio::task::spawn_blocking(move || {
        let mut conn = pool.get().map_err(|e| e.to_string())?;
        report(&mut conn, dimension, &filter).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}
