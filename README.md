# MyTube

A Chrome extension that lets you organize your YouTube subscriptions, playlists, and videos into folders and tags — right inside YouTube.

<p align="center">
  <img src="docs/screenshots/sidebar-void-theme.png" width="30%" alt="Sidebar with Void theme" />
  <img src="docs/screenshots/settings-panel.png" width="30%" alt="Settings panel" />
  <img src="docs/screenshots/sidebar-prism-theme.png" width="30%" alt="Sidebar with Prism theme" />
</p>

## Features

- **Folder hierarchy** — Organize channels, playlists, and videos into nested folders with drag-and-drop
- **Tag system** — Cross-cutting labels for flexible categorization
- **AI sorting** — Let a model propose a folder for every channel and playlist you haven't filed yet. Nothing is written until you approve it — see [below](#ai-sorting-optional)
- **Home feed** — Personal home page showing new videos from all your folders, with collapsible folder/channel sections and two modes: "new only" or "latest N per channel"
- **Folder feed** — View all recent videos from a folder's channels in one page, grouped by channel
- **NEW video badges** — New uploads are highlighted with accent borders, thumbnail badges, and meta row chips
- **New video detection** — Scrapes channel pages to track new uploads with per-channel badge counts (bilingual date parsing: EN + PT-BR)
- **Mute / unmute channels** — Channels are muted by default; enable notifications only for channels you care about
- **Mark as read** — Per-channel, per-folder (recursive), or mark all
- **Hover-to-act UI** — Action buttons appear on hover for channels in folders and library items (add to folder, tag, mute, delete, unsubscribe)
- **Two themes** — Void (minimal dark) and Prism (warm colorful) with 6 accent colors
- **Sidebar on YouTube** — Opens directly inside youtube.com, left or right, toggle with Cmd+.
- **Smart dedup** — 4-layer channel matching (ID, URL, handle, name) prevents duplicates across YouTube's inconsistent data formats
- **Export / Import** — Full JSON backup with merge or replace modes
- **Bilingual UI** — English and Brazilian Portuguese (all pages, including feed overlays)
- **Local by default** — All your organization data stays in chrome.storage + IndexedDB. No server, no account, no tracking. If you choose to connect an AI provider in Settings, only the channel names you ask it to classify are sent to that provider — nothing else, and nothing at all until you connect one.

## AI sorting (optional)

Filing hundreds of subscriptions by hand is the boring part. Connect a model and it proposes a folder for each one — you stay the one who decides.

<p align="center">
  <img src="docs/screenshots/ai-sorting-modal.png" width="70%" alt="AI suggestions grouped by destination folder, with per-group and per-item checkboxes" />
</p>

**Connecting.** Open the sidebar → gear → **AI**. Two paths:

- **Your ChatGPT account** — approve a device code on openai.com. No API key involved.
- **Any OpenAI-compatible endpoint** — your own base URL and key. A local Ollama, LM Studio, vLLM, OpenRouter, or OpenAI itself. Chrome asks permission for that host on the click that saves it.

Then hit **Test connection** to pick a model.

**Sorting.** In the Library, **✨ Sort with AI** targets whatever you selected, or — with nothing selected — everything on screen that has no folder yet.

- **Nothing is written until you accept.** Suggestions arrive grouped by destination folder, so a library of 800 channels is 8 decisions instead of 800. Check or uncheck a whole group or a single item, override any destination, then **Accept selected** or **Accept all**. New folders are created at that moment, never before.
- **The header names the model that produced the suggestions.** Swapping models changes the result, so the answer belongs on screen.
- **It takes a few minutes on a large library.** Items go out in batches of 20 and results stream in as each batch lands; the progress line shows the batch in flight and a running clock.

**What leaves your browser:** the names of the items being classified and the names of your existing folders. Nothing else — no watch history, no video data, no identifiers. And nothing at all until you connect a provider yourself.

## Install

1. Clone this repository:
   ```bash
   git clone https://github.com/pedroberaldo87/MyTube.git
   cd MyTube
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Build the extension:
   ```bash
   npm run build
   ```

4. Load in Chrome:
   - Open `chrome://extensions`
   - Enable **Developer mode**
   - Click **Load unpacked**
   - Select the `dist/` folder

## Tech Stack

Preact &middot; TypeScript &middot; Vite &middot; Chrome Extension Manifest V3 &middot; IndexedDB (via idb)

## License

This project is licensed under the [GNU General Public License v3.0](LICENSE).

MyTube - Chrome extension to organize YouTube with folders and tags
Copyright (C) 2025 Pedro Beraldo

---

## 🇧🇷 Portugues

Uma extensao do Chrome que permite organizar suas inscricoes, playlists e videos do YouTube em pastas e tags — direto dentro do YouTube.

### Funcionalidades

- **Pastas hierarquicas** — Organize canais, playlists e videos em pastas aninhadas com drag-and-drop
- **Sistema de tags** — Etiquetas transversais para categorizacao flexivel
- **Organizacao por IA** — Deixe um modelo propor uma pasta para cada canal e playlist que ainda nao foi arquivado. Nada e gravado ate voce aprovar — veja [abaixo](#organizacao-por-ia-opcional)
- **Home feed** — Pagina inicial pessoal com videos novos de todas as pastas, secoes colapsaveis por pasta/canal, dois modos: "so novos" ou "ultimos N por canal"
- **Feed de pasta** — Veja todos os videos recentes dos canais de uma pasta em uma pagina, agrupados por canal
- **Badges de video novo** — Uploads novos destacados com borda accent, badge na thumbnail e chip na linha de metadados
- **Deteccao de videos novos** — Scraping de paginas de canais para acompanhar novos uploads com contagem de badges por canal (parsing de datas bilingue: EN + PT-BR)
- **Silenciar / ativar canais** — Canais entram silenciados por padrao; ative notificacoes apenas nos canais que importam
- **Marcar como lido** — Por canal, por pasta inteira (recursivo), ou marcar tudo
- **UI hover-to-act** — Botoes de acao aparecem no hover para canais nas pastas e itens da biblioteca (adicionar a pasta, tag, silenciar, excluir, desinscrever)
- **Dois temas** — Void (minimalista escuro) e Prism (colorido quente) com 6 cores de destaque
- **Sidebar no YouTube** — Abre direto dentro do youtube.com, esquerda ou direita, toggle com Cmd+.
- **Dedup inteligente** — 4 camadas de matching de canais (ID, URL, handle, nome) evita duplicatas
- **Exportar / Importar** — Backup completo em JSON com modos merge ou replace
- **Interface bilingue** — Ingles e Portugues Brasileiro (todas as paginas, incluindo overlays de feed)
- **Local por padrao** — Todos os seus dados de organizacao ficam em chrome.storage + IndexedDB. Sem servidor, sem conta, sem rastreamento. Se voce optar por conectar um provedor de IA nas configuracoes, so os nomes dos canais que voce mandar classificar sao enviados a ele — nada alem disso, e nada ate voce conectar.

### Organizacao por IA (opcional)

Arquivar centenas de inscricoes na mao e a parte chata. Conecte um modelo e ele propoe uma pasta para cada uma — quem decide continua sendo voce.

<p align="center">
  <img src="docs/screenshots/ai-sorting-modal.png" width="70%" alt="Sugestoes da IA agrupadas por pasta de destino, com checkbox por grupo e por item" />
</p>

**Conectar.** Abra a sidebar → engrenagem → **IA**. Dois caminhos:

- **Sua conta ChatGPT** — voce aprova um codigo no site da OpenAI. Sem chave de API.
- **Qualquer endpoint compativel com a API da OpenAI** — voce informa a URL base e a chave. Um Ollama local, LM Studio, vLLM, OpenRouter, ou a propria OpenAI. O Chrome pede permissao para aquele host no clique que salva.

Depois use **Testar conexao** para escolher o modelo.

**Organizar.** Na Biblioteca, **✨ Organizar com IA** age sobre o que voce selecionou, ou — sem selecao — sobre tudo que esta na tela e ainda nao tem pasta.

- **Nada e gravado ate voce aceitar.** As sugestoes chegam agrupadas por pasta de destino, entao uma biblioteca de 800 canais vira 8 decisoes em vez de 800. Marque ou desmarque um grupo inteiro ou um item so, troque qualquer destino, e entao **Aceitar marcados** ou **Aceitar tudo**. Pastas novas nascem nesse momento, nunca antes.
- **O cabecalho diz qual modelo produziu as sugestoes.** Trocar de modelo muda o resultado, entao a resposta tem que estar na tela.
- **Leva alguns minutos numa biblioteca grande.** Os itens saem em lotes de 20 e os resultados vao aparecendo conforme cada lote volta; a linha de progresso mostra o lote em voo e um relogio correndo.

**O que sai do seu navegador:** os nomes dos itens sendo classificados e os nomes das suas pastas. Nada alem disso — nem historico, nem dados de video, nem identificadores. E nada ate voce mesmo conectar um provedor.

### Instalar

1. Clone este repositorio:
   ```bash
   git clone https://github.com/pedroberaldo87/MyTube.git
   cd MyTube
   ```

2. Instale as dependencias:
   ```bash
   npm install
   ```

3. Build da extensao:
   ```bash
   npm run build
   ```

4. Carregue no Chrome:
   - Abra `chrome://extensions`
   - Ative o **Modo do desenvolvedor**
   - Clique em **Carregar sem compactacao**
   - Selecione a pasta `dist/`

### Licenca

Este projeto esta licenciado sob a [GNU General Public License v3.0](LICENSE).
