import fs from "node:fs/promises";
import path from "node:path";
import express from "express";
import { getPrices } from "./prices.js";
import { buildDashboard } from "./analytics.js";

const PORT = Number(process.env.PORT) || 3000;
const portfolio = JSON.parse(await fs.readFile(path.resolve("data/portfolio.json"), "utf8"));

const app = express();
app.use(express.static(path.resolve("public")));
app.use("/vendor/chart.js", express.static(path.resolve("node_modules/chart.js/dist")));

app.get("/api/dashboard", async (req, res) => {
  try {
    const prices = await getPrices(portfolio, { force: req.query.refresh === "1" });
    res.json(buildDashboard(portfolio, prices));
  } catch (err) {
    console.error(err);
    res.status(502).json({ error: `Could not load market data: ${err.message}` });
  }
});

app.listen(PORT, () => {
  console.log(`Portfolio dashboard running at http://localhost:${PORT}`);
});
