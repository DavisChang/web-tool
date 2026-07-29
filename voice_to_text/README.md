# voice_to_text

把音檔／影片轉成文字。全程在本機跑（[faster-whisper](https://github.com/SYSTRAN/faster-whisper)），音檔不會上傳到任何服務。

輸入可以是：

- 本機檔案 — `talk.mp3`、`meeting.mp4`、`recording.m4a`…
- 直接音檔網址 — `https://.../episode.mp3`
- **網頁網址** — 腳本會自己去 HTML 裡找音檔連結（Podcast 頁面如 Firstory 適用）

---

## 安裝

需要 Python 3.9+。這台機器已經裝好 `faster-whisper`，直接用即可。

換一台機器時：

```bash
pip3 install -r requirements.txt
```

想跟系統 Python 隔離的話，在這個資料夾建 venv，`v2t` 會自動優先使用它：

```bash
cd ~/code/web-tool/voice_to_text
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
```

`ffmpeg` 不是必要的（faster-whisper 內建解碼），但裝了可以支援更多冷門格式。

---

## 快速開始

```bash
cd ~/code/web-tool/voice_to_text

# 最簡單：本機檔案，自動偵測語言
./v2t ~/Downloads/talk.mp3

# Podcast 網頁，指定中文
./v2t https://open.firstory.me/story/cms42320r10k501w0bxit0bq6 -l zh

# 會議錄影，同時輸出逐字稿和字幕檔
./v2t meeting.mp4 -l zh -f txt,srt -o ~/Documents/notes
```

第一次跑某個 model 會自動下載權重（`medium` 約 1.5GB），存在 `~/.cache/huggingface`，之後就不用再下載。

想在任何目錄直接呼叫，加個 alias：

```bash
echo "alias v2t='~/code/web-tool/voice_to_text/v2t'" >> ~/.zshrc && source ~/.zshrc
```

---

## 參數

| 參數 | 說明 | 預設 |
|---|---|---|
| `source` | 本機檔案 / 音檔網址 / 網頁網址 | （必填） |
| `-m, --model` | 模型大小，見下方對照表 | `medium` |
| `-l, --language` | 語言代碼 `zh` / `en` / `ja`… | 自動偵測 |
| `-f, --format` | 輸出格式，逗號分隔 | `txt` |
| `-o, --output-dir` | 輸出目錄 | `voice_to_text/output/` |
| `-p, --prompt` | 提示詞，用來校正專有名詞 | 無 |
| `--beam-size` | 越大越準也越慢 | `5` |
| `--threads` | CPU 執行緒數 | 全部核心 |
| `--device` | `auto` / `cpu` / `cuda` | `auto` |
| `--compute-type` | `int8` / `float16` / `float32` | CPU 用 `int8`，GPU 用 `float16` |
| `--no-vad` | 關掉靜音過濾 | 預設開啟 |
| `--work-dir` | 網址下載的暫存目錄 | `voice_to_text/.v2t-cache/` |

### 輸出格式

| 值 | 內容 |
|---|---|
| `txt` | 帶 `[mm:ss]` 時間戳的逐字稿 |
| `plain` | 純文字，沒有時間戳（丟給 LLM 做摘要最好用） |
| `srt` | 字幕檔 |
| `vtt` | WebVTT 字幕 |
| `json` | 每段的 `start` / `end` / `text`，方便後續程式處理 |

結果預設一律寫進 **`voice_to_text/output/`**（不管你從哪個目錄呼叫都一樣，這個資料夾已經在
`.gitignore` 裡，不會被 commit）。檔名是「音檔檔名 + 副檔名」，例如 `ep12.mp3` → `output/ep12.txt`。
要放別的地方就用 `-o`。

**轉錄過程中會邊跑邊寫檔**，所以中途 Ctrl-C 也保得住已完成的部分。

---

## 選模型

在這台 Mac（Apple Silicon 8 核，CPU int8）實測的速度：

| 模型 | 相對速度 | 43 分鐘音檔約需 | 中文品質 |
|---|---|---|---|
| `small` | ~3x realtime | ~15 分鐘 | 堪用，專有名詞錯字多 |
| `medium` | **~1x realtime** | ~43 分鐘 | 好，日常夠用 ← 預設 |
| `large-v3` | ~0.4x realtime | ~1.5–2 小時 | 最好，術語明顯較準 |

建議：

- **中文一律加 `-l zh`。** 不指定的話 Whisper 有機率誤判成粵語或日文，整篇就毀了。
- 趕時間或只是要抓大意 → `small`
- 要拿來當正式紀錄、有很多專業術語 → `large-v3`，睡前跑
- 有 NVIDIA GPU 的機器 → `--device cuda`，`large-v3` 也能快過 realtime

> CTranslate2 沒有 Apple GPU（MPS）後端，Mac 上一律走 CPU。這是上游限制，不是設定問題。

---

## 提高中文準確度

`-p` 提示詞會餵給模型當作開頭語境，對**專有名詞和繁簡體**特別有效：

```bash
./v2t episode.mp3 -l zh \
  -p "以下是繁體中文的podcast訪談，主題為台灣中小企業稅務、執行業務所得與薪資所得的申報。"
```

兩個作用：

1. 把領域術語先講一遍，模型比較不會聽成同音錯字
2. 提示詞用繁體字，輸出就傾向繁體（Whisper 預設常吐簡體）

---

## 常見問題

**有整段話沒被轉出來**
VAD 靜音過濾可能誤砍了小聲的段落。加 `--no-vad` 重跑。

**輸出是簡體字**
用繁體中文寫 `-p` 提示詞（見上）。或是輸出後用 OpenCC 轉換。

**記憶體不足 / 被系統砍掉**
降到小一點的模型，或減少 `--threads`。

**網頁抓不到音檔**
腳本是掃 HTML 找 `.mp3` / `.m4a` 這類連結。如果站台是用 JavaScript 動態載入，就抓不到 —
自己在瀏覽器開發者工具的 Network 分頁找到音檔網址，直接餵給腳本。

**同一個網址重複跑**
下載會快取在 `--work-dir`（預設 `./.v2t-cache`），第二次跑不會重新下載。不需要就直接刪掉那個資料夾。

---

## 註記

轉錄結果請自行校對後再使用，Whisper 會有辨識錯誤，數字、人名、專有名詞尤其容易出錯。
轉錄他人的內容時，注意來源的著作權與使用條款。
