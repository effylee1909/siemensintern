export function directoryContextIssue({ secure, topLevel, supported, active }) {
  if (!topLevel)
    return "目前網頁是在預覽或內嵌視窗中，瀏覽器可能禁止選取資料夾。請按「在獨立分頁開啟網站」，再按「開啟文件資料夾」。";
  if (!secure)
    return "資料夾存取需要安全連線。請使用下方 HTTPS 網站連結，勿直接開啟下載的 HTML 檔。";
  if (!supported)
    return "目前瀏覽器不支援此資料夾功能。請把網站網址貼到電腦版 Chrome 或 Edge 的網址列開啟。";
  if (active === false)
    return "瀏覽器需要你直接點擊按鈕才能開啟資料夾。請回到網站，重新按一次「開啟文件資料夾」。";
  return "";
}

export function directoryPickerError(error) {
  if (error.name === "AbortError") return "";
  if (["SecurityError", "NotAllowedError"].includes(error.name))
    return "瀏覽器拒絕了資料夾存取，尚未讀取或匯入文件。請在電腦版 Chrome／Edge 的獨立分頁直接開啟本站，再重試。若仍被拒絕，可能是公司瀏覽器或裝置政策限制，請由 IT 確認此網站是否允許讀寫本機資料夾。";
  return `無法開啟資料夾：${error.message}`;
}
