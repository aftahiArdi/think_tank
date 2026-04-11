#!/bin/bash
sudo tailscale funnel --https=10000 --set-path / --bg http://127.0.0.1:3004
