#!/usr/bin/env nu

const script_dir = path self | path dirname

def main [action: string] {
  cd $script_dir

  match $action {
    "on" => {
      with-env { FNOX_AGE_KEY_FILE: ($env.HOME | path join ".ssh" "id_ed25519") } {
        fnox exec -- docker compose up --detach --build
      }
    }
    "off" => {
      docker compose down
    }
    _ => { error make { msg: "Usage: ./toggle-run.nu <on|off>" } }
  }
}
