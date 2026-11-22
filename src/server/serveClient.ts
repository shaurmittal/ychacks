// Deploy: in production the Wasp server also serves the built client, so the whole app is one
// service on one URL (Railway). Only active when CLIENT_BUILD_DIR is set (see Dockerfile); dev is untouched.
import fs from "node:fs";
import path from "node:path";
import express from "express";
import type { ServerSetupFn } from "wasp/server";

export const serveClient: ServerSetupFn = async ({ app }) => {
  const dir = process.env.CLIENT_BUILD_DIR;
  if (!dir || !fs.existsSync(dir)) return;
  const shell = fs.existsSync(path.join(dir, "200.html")) ? "200.html" : "index.html";
  app.use(express.static(dir, { index: false, maxAge: "1h", dotfiles: "allow" }));
  // SPA fallback for client routes (/take/:id, /report/:id, ...). API routes are registered before this.
  app.get(/^(?!\/(api|operations|auth)(\/|$)).*/, (_req, res) => {
    res.sendFile(shell, { root: dir, dotfiles: "allow" });
  });
};
