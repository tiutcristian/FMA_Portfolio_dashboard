# FMA Portfolio Dashboard

A local web app that tracks the assets in the FMA course portfolio (from `CPFG en-1.xlsx`): the initial value from the spreadsheet, the closing price of every day since 12 Oct 2026, charts per asset and for the whole portfolio, and statistics.

## Run it

```bash
npm install
npm start
```

Open http://localhost:3000.

## What it shows

- **Key figures**: portfolio value, total P&L, best and worst asset, annualized volatility, max drawdown, days to the 15 Jan 2027 evaluation.
- **Charts**: portfolio value (EUR or % return), allocation (current or initial), cumulative return by asset, contribution of each asset to the portfolio return, and a close-price chart per asset with the spreadsheet's initial price as a dashed reference.
- **Statistics**: per asset and for the portfolio (daily and annualized volatility, best/worst day, drawdown, up/down days), plus a correlation matrix of daily returns.
- **Daily closes**: a table starting with the spreadsheet's initial values, then every fetched close.

## How the data works

- Assets, initial prices and allocations live in [data/portfolio.json](data/portfolio.json), copied from the spreadsheet. Edit it after a swap.
- Daily closes come from Yahoo Finance (`CSH2.PA`, `XEON.DE`, `XDWS.DE`, `IQQ0.DE`, `XDWH.DE`, `XDEW.DE`, `DNQ.F` for Equinor's Frankfurt EUR quote, `BTC-EUR`).
- A day is included only once its market has closed, so before the close you see data up to yesterday. Bitcoin's daily close is at 00:00 UTC, so today's candle never counts.
- Prices are cached for 30 minutes in `data/cache/`; "Refresh data" forces a new fetch. If Yahoo is unreachable, the last cached data is shown with a warning.
- Each position holds `allocation / initial price` units. The portfolio value carries each asset's last close forward on days it doesn't trade (e.g. ETFs on weekends while Bitcoin moves). Volatility and correlations use exchange trading days only.
