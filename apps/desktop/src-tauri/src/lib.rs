mod config;
mod lcu;
mod supabase;

use serde::Serialize;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct LcuStatus {
    connected: bool,
    message: String,
    summoner: Option<lcu::SummonerInfo>,
    party: Option<lcu::PartySnapshot>,
    champ_select: Option<lcu::ChampSelectSnapshot>,
}

#[tauri::command]
fn lcu_status() -> Result<LcuStatus, String> {
    let Some(lock) = lcu::read_lockfile() else {
        return Ok(LcuStatus {
            connected: false,
            message: "Abra o League Client (LoL)".into(),
            summoner: None,
            party: None,
            champ_select: None,
        });
    };

    let summoner = match lcu::current_summoner(&lock) {
        Ok(s) => Some(s),
        Err(e) => {
            return Ok(LcuStatus {
                connected: false,
                message: e,
                summoner: None,
                party: None,
                champ_select: None,
            });
        }
    };

    let party = lcu::detect_party(&lock)?.filter(|p| !p.members.is_empty() || !p.party_id.is_empty());
    let champ_select = lcu::champ_select_snapshot(&lock).unwrap_or(None);

    Ok(LcuStatus {
        connected: true,
        message: "LoL conectado".into(),
        summoner,
        party,
        champ_select,
    })
}

#[tauri::command]
fn pick_champion_skin(
    champion_id: i64,
    skin_id: i64,
) -> Result<lcu::ChampSelectSnapshot, String> {
    let lock = lcu::read_lockfile().ok_or_else(|| "Abra o League Client (LoL)".to_string())?;
    lcu::pick_champion_skin(&lock, champion_id, skin_id)
}

#[tauri::command]
fn sync_me() -> Result<serde_json::Value, String> {
    let cfg = config::load_config()?;
    let lock = lcu::read_lockfile().ok_or_else(|| "Abra o League Client (LoL)".to_string())?;
    let me = lcu::current_summoner(&lock)?;
    let ids = lcu::owned_skin_item_ids(&lock)?;
    let skins = supabase::sync_me(&cfg, &me, &ids)?;
    // Maestria no mesmo fluxo das skins — falha não bloqueia o inventário
    if let Ok(mastery) = lcu::local_champion_mastery(&lock) {
        let _ = supabase::sync_mastery(&cfg, &me, &mastery);
    }
    Ok(skins)
}

#[tauri::command]
fn sync_party(sync_inventory: Option<bool>) -> Result<serde_json::Value, String> {
    let cfg = config::load_config()?;
    let lock = lcu::read_lockfile().ok_or_else(|| "Abra o League Client (LoL)".to_string())?;
    let me = lcu::current_summoner(&lock)?;
    let party = lcu::detect_party(&lock)?
        .ok_or_else(|| "Entre num party/lobby no LoL".to_string())?;

    if sync_inventory.unwrap_or(false) {
        let ids = lcu::owned_skin_item_ids(&lock)?;
        let _ = supabase::sync_me(&cfg, &me, &ids)?;
        let mastery = lcu::local_champion_mastery(&lock).unwrap_or_default();
        let _ = supabase::sync_mastery(&cfg, &me, &mastery);
    }

    supabase::sync_party(&cfg, &me, &party)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            #[cfg(desktop)]
            app.handle()
                .plugin(tauri_plugin_updater::Builder::new().build())?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            lcu_status,
            sync_me,
            sync_party,
            pick_champion_skin
        ])
        .run(tauri::generate_context!())
        .expect("erro ao iniciar Skin Draft desktop");
}
