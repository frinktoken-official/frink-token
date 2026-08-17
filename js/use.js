(() => {
  const CHAIN_ID = 137;
  const CHAIN_HEX = "0x89";
  const FRINK = "0x822AC53a3037d328645B5aa7d6A07360AcC23433";
  const WPOL = "0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270";
  const ROUTER = "0xf5b509bB0909a69B1c207E495f687a596C168E12";
  const QUOTER = "0xa15F0D7377B2A0C0c10db057f641beD21028FC89";
  const EXPLORER = "https://polygonscan.com";
  const QUICKSWAP =
    "https://quickswap.exchange/#/swap?currency0=0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270&currency1=0x822AC53a3037d328645B5aa7d6A07360AcC23433";

  const ERC20_ABI = [
    "function balanceOf(address) view returns (uint256)",
    "function decimals() view returns (uint8)",
    "function allowance(address,address) view returns (uint256)",
    "function approve(address,uint256) returns (bool)",
    "function transfer(address,uint256) returns (bool)",
  ];

  const QUOTER_ABI = [
    "function quoteExactInputSingle(address tokenIn, address tokenOut, uint256 amountIn, uint160 limitSqrtPrice) returns (uint256 amountOut, uint16 fee)",
  ];

  const ROUTER_ABI = [
    "function exactInputSingle((address tokenIn, address tokenOut, address recipient, uint256 deadline, uint256 amountIn, uint256 amountOutMinimum, uint160 limitSqrtPrice)) payable returns (uint256 amountOut)",
    "function unwrapWNativeToken(uint256 amountMinimum, address recipient) payable",
    "function refundNativeToken() payable",
    "function multicall(bytes[] data) payable returns (bytes[])",
  ];

  const $ = (id) => document.getElementById(id);
  const els = {};
  let provider = null;
  let signer = null;
  let account = null;
  let quoteTimer = null;
  let lastQuote = null;

  function setStatus(el, text, kind) {
    if (!el) return;
    el.textContent = text || "";
    el.className = "use-status" + (kind ? " use-status--" + kind : "");
  }

  function shortAddr(addr) {
    return addr.slice(0, 6) + "…" + addr.slice(-4);
  }

  function requireEthers() {
    if (typeof ethers === "undefined") {
      throw new Error("ethers failed to load. Refresh the page.");
    }
  }

  function getEthereum() {
    if (window.ethereum) return window.ethereum;
    throw new Error("No wallet found. Install MetaMask or another injected wallet.");
  }

  async function ensurePolygon() {
    const eth = getEthereum();
    const chainId = await eth.request({ method: "eth_chainId" });
    if (chainId === CHAIN_HEX) return;
    try {
      await eth.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: CHAIN_HEX }],
      });
    } catch (err) {
      if (err && (err.code === 4902 || err.code === -32603)) {
        await eth.request({
          method: "wallet_addEthereumChain",
          params: [
            {
              chainId: CHAIN_HEX,
              chainName: "Polygon",
              nativeCurrency: { name: "POL", symbol: "POL", decimals: 18 },
              rpcUrls: ["https://polygon-rpc.com"],
              blockExplorerUrls: [EXPLORER + "/"],
            },
          ],
        });
        return;
      }
      throw err;
    }
  }

  async function refreshBalances() {
    if (!provider || !account) return;
    const frink = new ethers.Contract(FRINK, ERC20_ABI, provider);
    const [polWei, frinkWei] = await Promise.all([
      provider.getBalance(account),
      frink.balanceOf(account),
    ]);
    if (els.polBal) els.polBal.textContent = Number(ethers.formatEther(polWei)).toLocaleString(undefined, { maximumFractionDigits: 6 }) + " POL";
    if (els.frinkBal) els.frinkBal.textContent = Number(ethers.formatUnits(frinkWei, 18)).toLocaleString(undefined, { maximumFractionDigits: 4 }) + " FRINK";
  }

  async function connect() {
    requireEthers();
    const eth = getEthereum();
    await ensurePolygon();
    provider = new ethers.BrowserProvider(eth, CHAIN_ID);
    await provider.send("eth_requestAccounts", []);
    signer = await provider.getSigner();
    account = await signer.getAddress();
    if (els.walletBtn) els.walletBtn.textContent = shortAddr(account);
    if (els.walletMeta) {
      els.walletMeta.innerHTML =
        'Connected · Polygon · <a href="' + EXPLORER + "/address/" + account + '" target="_blank" rel="noopener">' +
        shortAddr(account) + "</a>";
    }
    await refreshBalances();
    scheduleQuote();
  }

  async function withWallet(fn) {
    if (!account) await connect();
    await ensurePolygon();
    provider = new ethers.BrowserProvider(getEthereum(), CHAIN_ID);
    signer = await provider.getSigner();
    account = await signer.getAddress();
    return fn();
  }

  async function sendTransfer(event) {
    event.preventDefault();
    const status = els.txStatus;
    try {
      const toRaw = (els.to.value || "").trim();
      if (!ethers.isAddress(toRaw)) throw new Error("Enter a valid Polygon address.");
      const to = ethers.getAddress(toRaw);
      if (to === ethers.ZeroAddress) throw new Error("Cannot send to the zero address.");
      const amount = ethers.parseUnits((els.amount.value || "0").trim(), 18);
      if (amount <= 0n) throw new Error("Enter an amount greater than zero.");
      setStatus(status, "Confirm the transfer in your wallet…", "info");
      await withWallet(async () => {
        const token = new ethers.Contract(FRINK, ERC20_ABI, signer);
        const bal = await token.balanceOf(account);
        if (bal < amount) throw new Error("Not enough FRINK in this wallet.");
        const tx = await token.transfer(to, amount);
        setStatus(status, "Submitted " + tx.hash.slice(0, 10) + "… waiting for Polygon.", "info");
        const rec = await tx.wait();
        const url = EXPLORER + "/tx/" + rec.hash;
        setStatus(status, "Sent. View on PolygonScan: " + rec.hash, "ok");
        if (els.txLink) {
          els.txLink.href = url;
          els.txLink.textContent = "Open transaction";
          els.txLink.hidden = false;
        }
      });
      await refreshBalances();
    } catch (err) {
      const msg = (err && err.shortMessage) || (err && err.message) || String(err);
      if (/user rejected|denied/i.test(msg)) {
        setStatus(status, "Cancelled in wallet.", "warn");
        return;
      }
      setStatus(status, msg, "err");
    }
  }

  function swapSides() {
    return els.dir.value === "pol-frink"
      ? { tokenIn: WPOL, tokenOut: FRINK, nativeIn: true, nativeOut: false, inLabel: "POL", outLabel: "FRINK" }
      : { tokenIn: FRINK, tokenOut: WPOL, nativeIn: false, nativeOut: true, inLabel: "FRINK", outLabel: "POL" };
  }

  function slippageBps() {
    const n = Number(els.slip.value);
    return Number.isFinite(n) && n >= 1 && n <= 50 ? BigInt(Math.round(n * 100)) : 1000n;
  }

  async function quote() {
    lastQuote = null;
    if (!els.swapIn || !els.quoteOut) return;
    const raw = (els.swapIn.value || "").trim();
    if (!raw || Number(raw) <= 0) {
      els.quoteOut.textContent = "—";
      els.quoteNote.textContent = "";
      return;
    }
    requireEthers();
    const sides = swapSides();
    const amountIn = ethers.parseUnits(raw, 18);
    const readProvider = provider || new ethers.JsonRpcProvider("https://polygon-bor-rpc.publicnode.com", CHAIN_ID);
    const quoter = new ethers.Contract(QUOTER, QUOTER_ABI, readProvider);
    try {
      const result = await quoter.quoteExactInputSingle.staticCall(
        sides.tokenIn,
        sides.tokenOut,
        amountIn,
        0
      );
      const amountOut = result.amountOut ?? result[0];
      lastQuote = { amountIn, amountOut, sides };
      const outNum = Number(ethers.formatUnits(amountOut, 18));
      els.quoteOut.textContent = outNum.toLocaleString(undefined, { maximumFractionDigits: 6 }) + " " + sides.outLabel;
      const minOut = amountOut - (amountOut * slippageBps()) / 10000n;
      els.quoteNote.textContent =
        "Minimum after slippage: " +
        Number(ethers.formatUnits(minOut, 18)).toLocaleString(undefined, { maximumFractionDigits: 6 }) +
        " " +
        sides.outLabel +
        ". Pool is thin (~10 POL). Large swaps will move the price.";
    } catch (err) {
      lastQuote = null;
      els.quoteOut.textContent = "No quote";
      const msg = (err && err.shortMessage) || (err && err.message) || "Quote failed";
      els.quoteNote.textContent = msg;
    }
  }

  function scheduleQuote() {
    clearTimeout(quoteTimer);
    quoteTimer = setTimeout(() => {
      quote().catch(() => {});
    }, 350);
  }

  async function sendSwap(event) {
    event.preventDefault();
    const status = els.swapStatus;
    try {
      await quote();
      if (!lastQuote) throw new Error("Wait for a quote before swapping.");
      const { amountIn, amountOut, sides } = lastQuote;
      const minOut = amountOut - (amountOut * slippageBps()) / 10000n;
      if (minOut <= 0n) throw new Error("Quoted output is too small after slippage.");
      setStatus(status, "Confirm in your wallet…", "info");
      await withWallet(async () => {
        const router = new ethers.Contract(ROUTER, ROUTER_ABI, signer);
        const deadline = BigInt(Math.floor(Date.now() / 1000) + 1200);
        if (sides.nativeIn) {
          const pol = await provider.getBalance(account);
          if (pol < amountIn) throw new Error("Not enough POL for this swap plus gas.");
          const dataSwap = router.interface.encodeFunctionData("exactInputSingle", [
            {
              tokenIn: WPOL,
              tokenOut: FRINK,
              recipient: account,
              deadline,
              amountIn,
              amountOutMinimum: minOut,
              limitSqrtPrice: 0,
            },
          ]);
          const dataRefund = router.interface.encodeFunctionData("refundNativeToken", []);
          const tx = await router.multicall([dataSwap, dataRefund], { value: amountIn });
          setStatus(status, "Submitted " + tx.hash.slice(0, 10) + "…", "info");
          const rec = await tx.wait();
          finishSwap(status, rec.hash);
          return;
        }
        const token = new ethers.Contract(FRINK, ERC20_ABI, signer);
        const bal = await token.balanceOf(account);
        if (bal < amountIn) throw new Error("Not enough FRINK in this wallet.");
        const allowance = await token.allowance(account, ROUTER);
        if (allowance < amountIn) {
          setStatus(status, "Approve FRINK for the QuickSwap router…", "info");
          const approveTx = await token.approve(ROUTER, amountIn);
          await approveTx.wait();
        }
        const dataSwap = router.interface.encodeFunctionData("exactInputSingle", [
          {
            tokenIn: FRINK,
            tokenOut: WPOL,
            recipient: ROUTER,
            deadline,
            amountIn,
            amountOutMinimum: minOut,
            limitSqrtPrice: 0,
          },
        ]);
        const dataUnwrap = router.interface.encodeFunctionData("unwrapWNativeToken", [minOut, account]);
        const tx = await router.multicall([dataSwap, dataUnwrap]);
        setStatus(status, "Submitted " + tx.hash.slice(0, 10) + "…", "info");
        const rec = await tx.wait();
        finishSwap(status, rec.hash);
      });
      await refreshBalances();
      scheduleQuote();
    } catch (err) {
      const msg = (err && err.shortMessage) || (err && err.message) || String(err);
      if (/user rejected|denied/i.test(msg)) {
        setStatus(status, "Cancelled in wallet.", "warn");
        return;
      }
      setStatus(status, msg, "err");
    }
  }

  function finishSwap(status, hash) {
    setStatus(status, "Swap confirmed. " + hash, "ok");
    if (els.swapLink) {
      els.swapLink.href = EXPLORER + "/tx/" + hash;
      els.swapLink.textContent = "Open transaction";
      els.swapLink.hidden = false;
    }
  }

  function showPanel() {
    if (!els.panelTransfer || !els.panelSwap) return;
    const hash = (location.hash || "").replace("#", "");
    const swap = hash === "swap";
    els.panelTransfer.hidden = swap;
    els.panelSwap.hidden = !swap;
    if (els.tabTransfer) els.tabTransfer.classList.toggle("active", !swap);
    if (els.tabSwap) els.tabSwap.classList.toggle("active", swap);
  }

  function bind() {
    if (!$("walletBtn") || !$("transferForm")) return;
    els.walletBtn = $("walletBtn");
    els.walletMeta = $("walletMeta");
    els.polBal = $("polBal");
    els.frinkBal = $("frinkBal");
    els.to = $("toAddress");
    els.amount = $("sendAmount");
    els.txStatus = $("txStatus");
    els.txLink = $("txLink");
    els.dir = $("swapDir");
    els.swapIn = $("swapAmount");
    els.slip = $("slippage");
    els.quoteOut = $("quoteOut");
    els.quoteNote = $("quoteNote");
    els.swapStatus = $("swapStatus");
    els.swapLink = $("swapLink");
    els.panelTransfer = $("panelTransfer") || $("transfer");
    els.panelSwap = $("panelSwap") || $("swap");
    els.tabTransfer = $("tabTransfer");
    els.tabSwap = $("tabSwap");
    const qs = $("quickswapLink");
    if (qs) qs.href = QUICKSWAP;

    els.walletBtn.addEventListener("click", () => {
      connect().catch((err) => {
        setStatus(els.txStatus, err.message || String(err), "err");
        setStatus(els.swapStatus, err.message || String(err), "err");
      });
    });
    $("transferForm").addEventListener("submit", sendTransfer);
    $("swapForm").addEventListener("submit", sendSwap);
    els.dir.addEventListener("change", scheduleQuote);
    els.swapIn.addEventListener("input", scheduleQuote);
    els.slip.addEventListener("change", scheduleQuote);
    $("maxFrink").addEventListener("click", async () => {
      try {
        await withWallet(async () => {
          const token = new ethers.Contract(FRINK, ERC20_ABI, provider);
          const bal = await token.balanceOf(account);
          els.amount.value = ethers.formatUnits(bal, 18);
        });
      } catch (err) {
        setStatus(els.txStatus, err.message || String(err), "err");
      }
    });
    window.addEventListener("hashchange", showPanel);
    showPanel();
    if (window.ethereum) {
      window.ethereum.on("accountsChanged", () => {
        account = null;
        connect().catch(() => {});
      });
      window.ethereum.on("chainChanged", () => window.location.reload());
    }
  }

  document.addEventListener("DOMContentLoaded", bind);
})();
