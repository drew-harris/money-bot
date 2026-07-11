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
    "dev" => {
      docker compose down
      do --ignore-errors { tmux kill-session -t money-bot-dev }
      tmux new-session -d -s money-bot-dev "pnpm dev"
    }
    _ => { error make { msg: "Usage: ./toggle-run.nu <on|off|dev>" } }
  }
}
