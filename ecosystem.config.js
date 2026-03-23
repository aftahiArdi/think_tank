module.exports = {
  apps: [
    {
      name: "think-tank-api",
      script: "/home/ardi/Projects/think_tank/.venv/bin/gunicorn",
      args: "app:app -w 1 --threads 4 --preload -b 0.0.0.0:6000",
      cwd: "/home/ardi/Projects/think_tank",
      interpreter: "none",
      env: {
        THINK_TANK_PASSWORD: "change-me",
      },
    },
    {
      name: "think-tank-frontend",
      script: "npm",
      args: "run dev",
      cwd: "/home/ardi/Projects/think_tank/frontend",
      interpreter: "none",
      env: {
        NODE_ENV: "development",
        PORT: 3004,
        API_URL: "http://localhost:6000",
        THINK_TANK_PASSWORD: "changeme",
        COOKIE_SECRET: "dev-secret-change-me",
      },
    },
  ],
};
