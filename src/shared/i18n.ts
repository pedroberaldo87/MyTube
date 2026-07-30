import { createContext } from 'preact'
import { useContext } from 'preact/hooks'

export type Language = 'en' | 'pt-BR'

const translations = {
  // Sidebar
  'sidebar.loading': { en: 'Loading…', 'pt-BR': 'Carregando…' },
  'sidebar.syncSubs': { en: 'Subs', 'pt-BR': 'Canais' },
  'sidebar.syncLists': { en: 'Lists', 'pt-BR': 'Listas' },
  'sidebar.folders': { en: 'Folders', 'pt-BR': 'Pastas' },
  'sidebar.library': { en: 'Library', 'pt-BR': 'Biblioteca' },
  'sidebar.tags': { en: 'Tags', 'pt-BR': 'Tags' },
  'sidebar.tagline': { en: 'Organized joy.', 'pt-BR': 'Organização é alegria.' },
  'sidebar.items': { en: 'items', 'pt-BR': 'itens' },

  // FilterBar
  'filter.search': { en: 'Search...', 'pt-BR': 'Buscar...' },
  'filter.all': { en: 'All', 'pt-BR': 'Todos' },
  'filter.channels': { en: '📺 Channels', 'pt-BR': '📺 Canais' },
  'filter.playlists': { en: '📋 Playlists', 'pt-BR': '📋 Playlists' },
  'filter.videos': { en: '🎬 Videos', 'pt-BR': '🎬 Vídeos' },
  'filter.noFolder': { en: 'No folder', 'pt-BR': 'Sem pasta' },

  // Library
  'library.select': { en: 'Select', 'pt-BR': 'Selecionar' },
  'library.cancel': { en: 'Cancel', 'pt-BR': 'Cancelar' },
  'library.of': { en: 'of', 'pt-BR': 'de' },
  'library.selectAll': { en: 'Select all', 'pt-BR': 'Selecionar tudo' },
  'library.deselectAll': { en: 'Deselect all', 'pt-BR': 'Desmarcar tudo' },
  'library.empty': { en: 'No items in library yet.', 'pt-BR': 'Nenhum item na biblioteca.' },
  'library.onboarding': { en: 'Sync your YouTube subscriptions to get started.', 'pt-BR': 'Sincronize suas inscrições do YouTube para começar.' },
  'library.onboardingAction': { en: '⟳ Sync Subscriptions', 'pt-BR': '⟳ Sincronizar Inscrições' },
  'library.noMatch': { en: 'No items match your filters.', 'pt-BR': 'Nenhum item corresponde aos filtros.' },
  'library.showMore': { en: 'more...', 'pt-BR': 'mais...' },

  // LibraryItem
  'item.folder': { en: 'Folder', 'pt-BR': 'Pasta' },
  'item.noFolder': { en: 'No folder', 'pt-BR': 'Sem pasta' },
  'item.tags': { en: 'Tags', 'pt-BR': 'Tags' },
  'item.delete': { en: 'Delete', 'pt-BR': 'Excluir' },
  'item.confirmDelete': { en: 'Confirm delete?', 'pt-BR': 'Confirmar exclusão?' },

  // FolderTree
  'folder.search': { en: 'Search in folders...', 'pt-BR': 'Buscar nas pastas...' },
  'folder.noResults': { en: 'No matches found.', 'pt-BR': 'Nenhum resultado encontrado.' },
  'folder.sort': { en: 'Sort', 'pt-BR': 'Ordenar' },
  'folder.sortManual': { en: 'Manual order', 'pt-BR': 'Ordem manual' },
  'folder.sortAZ': { en: 'A → Z', 'pt-BR': 'A → Z' },
  'folder.sortZA': { en: 'Z → A', 'pt-BR': 'Z → A' },
  'folder.sortNewFirst': { en: 'New videos first', 'pt-BR': 'Vídeos novos primeiro' },
  'folder.sortOldFirst': { en: 'Oldest videos first', 'pt-BR': 'Vídeos mais antigos primeiro' },
  'folder.empty': { en: 'No folders yet.', 'pt-BR': 'Nenhuma pasta ainda.' },
  'folder.new': { en: '＋ New Folder', 'pt-BR': '＋ Nova Pasta' },
  'folder.newSub': { en: 'New Subfolder', 'pt-BR': 'Nova Subpasta' },
  'folder.edit': { en: 'Edit Folder', 'pt-BR': 'Editar Pasta' },
  'folder.name': { en: 'Folder name...', 'pt-BR': 'Nome da pasta...' },
  'folder.subName': { en: 'Subfolder name...', 'pt-BR': 'Nome da subpasta...' },
  'folder.confirmDelete': { en: 'Confirm delete', 'pt-BR': 'Confirmar exclusão' },
  'folder.deleteTitle': { en: 'Delete folder', 'pt-BR': 'Excluir pasta' },

  // TagManager
  'tag.empty': { en: 'No tags yet.', 'pt-BR': 'Nenhuma tag ainda.' },
  'tag.new': { en: '＋ New Tag', 'pt-BR': '＋ Nova Tag' },
  'tag.newLabel': { en: 'New tag', 'pt-BR': 'Nova tag' },
  'tag.namePlaceholder': { en: 'Tag name…', 'pt-BR': 'Nome da tag…' },
  'tag.deleteConfirm': { en: 'Delete?', 'pt-BR': 'Excluir?' },
  'tag.yes': { en: 'Yes', 'pt-BR': 'Sim' },
  'tag.no': { en: 'No', 'pt-BR': 'Não' },

  // BatchActionBar
  'batch.selected': { en: 'selected', 'pt-BR': 'selecionados' },
  'batch.assignFolder': { en: 'Assign folder', 'pt-BR': 'Atribuir pasta' },
  'batch.chooseFolder': { en: 'Choose folder...', 'pt-BR': 'Escolher pasta...' },
  'batch.noFolder': { en: 'No folder', 'pt-BR': 'Sem pasta' },
  'batch.newFolder': { en: 'New folder', 'pt-BR': 'Nova pasta' },
  'batch.toggleTags': { en: 'Toggle tags', 'pt-BR': 'Alternar tags' },
  'batch.deleteSelected': { en: 'Delete selected', 'pt-BR': 'Excluir selecionados' },
  'batch.confirmDelete': { en: 'Confirm delete', 'pt-BR': 'Confirmar exclusão' },
  'batch.unsubscribe': { en: 'Unsubscribe selected', 'pt-BR': 'Desinscrever selecionados' },
  'batch.confirmUnsub': { en: 'Confirm unsubscribe', 'pt-BR': 'Confirmar desinscrição' },

  // ExportImport
  'data.export': { en: 'Export Backup', 'pt-BR': 'Exportar Backup' },
  'data.import': { en: 'Import Backup', 'pt-BR': 'Importar Backup' },
  'data.exported': { en: '✓ Exported', 'pt-BR': '✓ Exportado' },
  'data.imported': { en: '✓ Imported successfully', 'pt-BR': '✓ Importado com sucesso' },
  'data.merge': { en: 'Merge', 'pt-BR': 'Mesclar' },
  'data.replace': { en: 'Replace', 'pt-BR': 'Substituir' },
  'data.found': { en: 'Found', 'pt-BR': 'Encontrados' },
  'data.channel': { en: 'channel', 'pt-BR': 'canal' },
  'data.channels': { en: 'channels', 'pt-BR': 'canais' },
  'data.playlist': { en: 'playlist', 'pt-BR': 'playlist' },
  'data.playlists': { en: 'playlists', 'pt-BR': 'playlists' },
  'data.video': { en: 'video', 'pt-BR': 'vídeo' },
  'data.videos': { en: 'videos', 'pt-BR': 'vídeos' },
  'data.folder': { en: 'folder', 'pt-BR': 'pasta' },
  'data.folders': { en: 'folders', 'pt-BR': 'pastas' },
  'data.tag': { en: 'tag', 'pt-BR': 'tag' },
  'data.tags': { en: 'tags', 'pt-BR': 'tags' },
  'data.entry': { en: 'entry', 'pt-BR': 'entrada' },
  'data.entries': { en: 'entries', 'pt-BR': 'entradas' },
  'data.watch': { en: 'watch', 'pt-BR': 'visualiz.' },

  // SettingsPanel
  'settings.theme': { en: 'Theme', 'pt-BR': 'Tema' },
  'settings.accent': { en: 'Accent Color', 'pt-BR': 'Cor de Destaque' },
  'settings.position': { en: 'Sidebar Position', 'pt-BR': 'Posição da Sidebar' },
  'settings.left': { en: 'Left', 'pt-BR': 'Esquerda' },
  'settings.right': { en: 'Right', 'pt-BR': 'Direita' },
  'settings.nowPlaying': { en: 'Show Now Playing', 'pt-BR': 'Mostrar Reproduzindo' },
  'settings.language': { en: 'Language', 'pt-BR': 'Idioma' },
  'settings.data': { en: 'Data', 'pt-BR': 'Dados' },
  'settings.openNewTab': { en: 'Open videos in new tab', 'pt-BR': 'Abrir vídeos em nova aba' },
  'settings.tagline': { en: 'Organize YouTube with folders and tags', 'pt-BR': 'Organize o YouTube com pastas e tags' },
  'settings.homeEntry': { en: 'Home greeting', 'pt-BR': 'Aviso na home' },
  'settings.homeEntryCard': { en: 'Card', 'pt-BR': 'Card' },
  'settings.homeEntryTabV': { en: 'Tab', 'pt-BR': 'Aba' },
  'settings.homeEntryTabH': { en: 'Pill', 'pt-BR': 'Pílula' },
  'settings.homeEntryOff': { en: 'Off', 'pt-BR': 'Desligado' },

  // NowPlaying
  'np.untitledVideo': { en: 'Untitled Video', 'pt-BR': 'Vídeo sem título' },
  'np.unknownChannel': { en: 'Unknown Channel', 'pt-BR': 'Canal desconhecido' },
  'np.untitledPlaylist': { en: 'Untitled Playlist', 'pt-BR': 'Playlist sem título' },
  'np.loadingVideo': { en: 'Loading video…', 'pt-BR': 'Carregando vídeo…' },
  'np.saveVideo': { en: '＋ Save Video', 'pt-BR': '＋ Salvar Vídeo' },
  'np.saveChannel': { en: '＋ Save Channel', 'pt-BR': '＋ Salvar Canal' },
  'np.savePlaylist': { en: '＋ Save Playlist', 'pt-BR': '＋ Salvar Playlist' },
  'np.videoSaved': { en: '✓ Video Saved', 'pt-BR': '✓ Vídeo Salvo' },
  'np.channelSaved': { en: '✓ Channel Saved', 'pt-BR': '✓ Canal Salvo' },
  'np.playlistSaved': { en: '✓ Playlist Saved', 'pt-BR': '✓ Playlist Salva' },
  'np.folder': { en: 'Folder', 'pt-BR': 'Pasta' },
  'np.noFolder': { en: 'No folder', 'pt-BR': 'Sem pasta' },
  'np.tags': { en: 'Tags', 'pt-BR': 'Tags' },
  'np.navigate': { en: 'Navigate to a video, channel, or playlist', 'pt-BR': 'Navegue até um vídeo, canal ou playlist' },
  'np.title': { en: 'NOW PLAYING', 'pt-BR': 'REPRODUZINDO' },

  // ExportImport errors
  'data.invalidFile': { en: 'Invalid backup file structure.', 'pt-BR': 'Estrutura do arquivo de backup inválida.' },
  'data.parseError': { en: 'Could not parse file as JSON.', 'pt-BR': 'Não foi possível ler o arquivo como JSON.' },
  'data.exportFailed': { en: 'Export failed', 'pt-BR': 'Falha na exportação' },
  'data.importFailed': { en: 'Import failed', 'pt-BR': 'Falha na importação' },

  // SettingsPanel - Prism/Void labels
  'settings.prism': { en: 'Prism', 'pt-BR': 'Prism' },
  'settings.void': { en: 'Void', 'pt-BR': 'Void' },

  // Badge
  'badge.markAllRead': { en: 'Mark all read', 'pt-BR': 'Marcar tudo como lido' },
  'badge.markRead': { en: 'Mark as read', 'pt-BR': 'Marcar como lido' },

  // Home
  'home.open': { en: 'Home', 'pt-BR': 'Início' },
  'home.settingsTitle': { en: 'Home Page', 'pt-BR': 'Página Inicial' },
  'home.modeNewOnly': { en: 'New videos only', 'pt-BR': 'Só vídeos novos' },
  'home.modeLatest': { en: 'Latest per channel', 'pt-BR': 'Últimos por canal' },
  'home.videosPerChannel': { en: 'videos per channel', 'pt-BR': 'vídeos por canal' },
  'home.foldersExpanded': { en: 'Open folders expanded', 'pt-BR': 'Abrir pastas expandidas' },
  'home.new': { en: 'new', 'pt-BR': 'novos' },
  'home.loading': { en: 'Loading home feed...', 'pt-BR': 'Carregando feed...' },
  'home.empty': { en: 'All caught up — no new videos!', 'pt-BR': 'Tudo em dia — nenhum vídeo novo!' },
  'home.markAllRead': { en: '✓ Mark all read', 'pt-BR': '✓ Marcar tudo como lido' },
  'home.read': { en: '✓ Read', 'pt-BR': '✓ Lido' },
  'home.markWatched': { en: 'Mark as watched', 'pt-BR': 'Marcar como assistido' },
  'home.watchLater': { en: 'Watch later', 'pt-BR': 'Assistir mais tarde' },
  'home.watchLaterDone': { en: 'Saved to Watch Later', 'pt-BR': 'Salvo em Assistir mais tarde' },
  'home.watchLaterError': { en: 'Could not save to Watch Later', 'pt-BR': 'Não foi possível salvar' },

  // Feed
  'feed.loading': { en: 'Loading feed...', 'pt-BR': 'Carregando feed...' },
  'feed.videos': { en: 'videos', 'pt-BR': 'vídeos' },
  'feed.video': { en: 'video', 'pt-BR': 'vídeo' },
  'feed.allWatched': { en: 'All videos have been watched', 'pt-BR': 'Todos os vídeos foram assistidos' },
  'feed.empty': { en: 'No videos found in this folder', 'pt-BR': 'Nenhum vídeo encontrado nesta pasta' },
  'feed.watched': { en: 'watched', 'pt-BR': 'assistido' },

  // HomeNudge
  'nudge.newVideos': { en: 'New Videos', 'pt-BR': 'Vídeos Novos' },
  'nudge.byFolder': { en: 'By folder', 'pt-BR': 'Por pasta' },
  'nudge.openFeed': { en: 'Open My Feed', 'pt-BR': 'Abrir Meu Feed' },

  // HomeTab (orelhinha)
  'tab.hint': { en: "See what's new", 'pt-BR': 'Ver novidades' },

  // FolderTree tooltips
  'folder.selectAll': { en: 'Select all in folder', 'pt-BR': 'Selecionar tudo na pasta' },
  'folder.markAllRead': { en: 'Mark all as read', 'pt-BR': 'Marcar tudo como lido' },
  'folder.openFeed': { en: 'Open feed', 'pt-BR': 'Abrir feed' },
  'folder.addSubfolder': { en: 'Add subfolder', 'pt-BR': 'Adicionar subpasta' },
  'folder.editFolder': { en: 'Edit folder', 'pt-BR': 'Editar pasta' },
  'folder.moveToFolder': { en: 'Move to folder', 'pt-BR': 'Mover para pasta' },
  'folder.removeFromFolder': { en: 'Remove from folder', 'pt-BR': 'Remover da pasta' },
  'folder.confirmRemove': { en: 'Confirm remove', 'pt-BR': 'Confirmar remoção' },
  'folder.noFolder': { en: 'No folder', 'pt-BR': 'Sem pasta' },

  // Item tooltips
  'item.markRead': { en: 'Mark as read', 'pt-BR': 'Marcar como lido' },
  'item.enableNotifications': { en: 'Enable notifications', 'pt-BR': 'Ativar notificações' },
  'item.disableNotifications': { en: 'Disable notifications', 'pt-BR': 'Desativar notificações' },
  'item.confirmUnsubscribe': { en: 'Confirm unsubscribe', 'pt-BR': 'Confirmar desinscrição' },
  'item.unsubscribe': { en: 'Unsubscribe on YouTube', 'pt-BR': 'Desinscrever no YouTube' },

  // Sidebar tooltips
  'sidebar.settings': { en: 'Settings', 'pt-BR': 'Configurações' },
  'sidebar.close': { en: 'Close', 'pt-BR': 'Fechar' },

  // Settings panel
  'settings.muteAll': { en: 'Mute all channels', 'pt-BR': 'Silenciar todos os canais' },

  // Dashboard
  'dashboard.channels': { en: 'Channels', 'pt-BR': 'Canais' },
  'dashboard.playlists': { en: 'Playlists', 'pt-BR': 'Playlists' },
  'dashboard.folders': { en: 'Folders', 'pt-BR': 'Pastas' },
  'dashboard.settings': { en: 'Settings', 'pt-BR': 'Configurações' },
  'dashboard.loading': { en: 'Loading...', 'pt-BR': 'Carregando...' },
  'dashboard.error': { en: 'Failed to load data. Make sure the extension is running.', 'pt-BR': 'Falha ao carregar dados. Verifique se a extensão está ativa.' },
  'dashboard.retry': { en: 'Retry', 'pt-BR': 'Tentar novamente' },

  // Error messages
  'error.loadHomeFeed': { en: 'Failed to load home feed', 'pt-BR': 'Falha ao carregar feed principal' },
  'error.loadFolderFeed': { en: 'Failed to load feed', 'pt-BR': 'Falha ao carregar feed' },

  // Injector toolbar
  'injector.inMyTube': { en: '✓ MyTube', 'pt-BR': '✓ MyTube' },
  'injector.addMyTube': { en: '＋ MyTube', 'pt-BR': '＋ MyTube' },

  // Common
  'common.save': { en: 'Save', 'pt-BR': 'Salvar' },
  'common.cancel': { en: 'Cancel', 'pt-BR': 'Cancelar' },
  'common.create': { en: 'Create', 'pt-BR': 'Criar' },
  'common.add': { en: 'Add', 'pt-BR': 'Adicionar' },

  // AI
  'ai.title': { en: 'AI Connection', 'pt-BR': 'Conexão com IA' },
  'ai.intro': {
    en: 'Nothing is sent anywhere until you connect a provider.',
    'pt-BR': 'Nada é enviado a lugar nenhum até você conectar um provedor.',
  },
  'ai.connectChatGPT': { en: 'Connect ChatGPT account', 'pt-BR': 'Conectar conta ChatGPT' },
  'ai.addEndpoint': { en: 'Add endpoint', 'pt-BR': 'Adicionar endpoint' },
  'ai.deviceInstructions': {
    en: 'Open the page below and type this code:',
    'pt-BR': 'Abra a página abaixo e digite este código:',
  },
  'ai.deviceOpen': { en: 'Open authorization page', 'pt-BR': 'Abrir página de autorização' },
  'ai.deviceWaiting': { en: 'Waiting for approval…', 'pt-BR': 'Aguardando aprovação…' },
  'ai.deviceFinishing': { en: 'Approved — finishing the connection…', 'pt-BR': 'Aprovado — concluindo a conexão…' },
  'ai.deviceExpired': { en: 'Code expired. Try again.', 'pt-BR': 'Código expirou. Tente de novo.' },
  'ai.labelField': { en: 'Name', 'pt-BR': 'Nome' },
  'ai.urlField': { en: 'Base URL', 'pt-BR': 'URL base' },
  'ai.keyField': { en: 'API key', 'pt-BR': 'Chave de API' },
  'ai.model': { en: 'Model', 'pt-BR': 'Modelo' },
  'ai.test': { en: 'Test connection', 'pt-BR': 'Testar conexão' },
  'ai.testOk': { en: 'Connected', 'pt-BR': 'Conectado' },
  'ai.testFail': { en: 'Failed', 'pt-BR': 'Falhou' },
  'ai.active': { en: 'Active', 'pt-BR': 'Ativo' },
  'ai.remove': { en: 'Remove', 'pt-BR': 'Remover' },
  'ai.save': { en: 'Save', 'pt-BR': 'Salvar' },
  'ai.cancel': { en: 'Cancel', 'pt-BR': 'Cancelar' },
  'ai.edit': { en: 'Edit', 'pt-BR': 'Editar' },
  'ai.keyHelpEdit': {
    en: 'Leave blank to keep the current key.',
    'pt-BR': 'Deixe em branco para manter a chave atual.',
  },
  'ai.addTitle': { en: 'Add a provider', 'pt-BR': 'Adicionar um provedor' },
  'ai.pathOAuth': {
    en: 'Your ChatGPT account. You approve a code on the OpenAI site, no API key needed.',
    'pt-BR': 'Sua conta ChatGPT. Você aprova um código no site da OpenAI, sem precisar de chave.',
  },
  'ai.pathApiKey': {
    en: 'Any server that speaks the OpenAI API. You provide the address and a key.',
    'pt-BR': 'Qualquer servidor que fale a API da OpenAI. Você informa o endereço e uma chave.',
  },
  'ai.urlHelp': {
    en: 'Include the path, usually ending in /v1. Example: localhost:11434/v1',
    'pt-BR': 'Inclua o caminho, normalmente terminando em /v1. Exemplo: localhost:11434/v1',
  },
  'ai.labelHelp': {
    en: 'Optional. Defaults to the address.',
    'pt-BR': 'Opcional. Por padrão, usa o endereço.',
  },
  'ai.keyHelp': {
    en: 'Sent only to this address, and never leaves the extension.',
    'pt-BR': 'Enviada só para esse endereço, e nunca sai da extensão.',
  },
  'ai.saving': { en: 'Saving…', 'pt-BR': 'Salvando…' },
  'ai.testing': { en: 'Testing…', 'pt-BR': 'Testando…' },
  'ai.loadingModels': { en: 'Loading models…', 'pt-BR': 'Carregando modelos…' },
  'ai.noModels': {
    en: 'The provider returned no models.',
    'pt-BR': 'O provedor não devolveu nenhum modelo.',
  },
  'ai.noCredential': {
    en: 'No API key saved for this provider.',
    'pt-BR': 'Nenhuma chave de API guardada para este provedor.',
  },
  'ai.errInvalidUrl': {
    en: 'That address is not valid. Example: localhost:11434/v1',
    'pt-BR': 'Esse endereço não é válido. Exemplo: localhost:11434/v1',
  },
  'ai.errCannotRequest': {
    en: 'The extension cannot ask for access to that address.',
    'pt-BR': 'A extensão não consegue pedir acesso a esse endereço.',
  },
  'ai.errPermissionDenied': {
    en: 'You declined access to that address.',
    'pt-BR': 'Você recusou o acesso a esse endereço.',
  },
  'ai.empty': { en: 'No provider connected yet.', 'pt-BR': 'Nenhum provedor conectado ainda.' },
  'ai.errProviderNotFound': {
    en: 'Provider not found — reload the page and try again.',
    'pt-BR': 'Provedor não encontrado — recarregue a página e tente de novo.',
  },
  'ai.errOAuthExchange': {
    en: 'Authorization could not be completed — the code was already used. Connect again.',
    'pt-BR': 'Não foi possível concluir a autorização — o código já foi usado. Conecte de novo.',
  },
  'ai.errInternal': {
    en: 'Internal extension error. Try again.',
    'pt-BR': 'Erro interno da extensão. Tente de novo.',
  },
  // Host permission dialog (janela popup própria)
  'perm.title': { en: 'Permission needed', 'pt-BR': 'Permissão necessária' },
  'perm.line': {
    en: 'MyTube needs your permission to talk to',
    'pt-BR': 'O MyTube precisa da sua permissão para falar com',
  },
  'perm.allow': { en: 'Allow', 'pt-BR': 'Permitir' },

  // Aviso de saúde do scraper — ver channel-poller.ts → ScrapeHealth
  'scrape.brokeTitle': {
    en: "Could not read your channels' pages",
    'pt-BR': 'Não consegui ler as páginas dos seus canais',
  },
  'scrape.brokeBody': {
    en: 'YouTube may have changed its page format. New videos will not appear until this is fixed.',
    'pt-BR': 'O YouTube pode ter mudado o formato das páginas. Vídeos novos não vão aparecer até isso ser corrigido.',
  },
  'scrape.undatedTitle': { en: "Could not read the videos' dates", 'pt-BR': 'Não consegui ler as datas dos vídeos' },
  'scrape.undatedBody': {
    en: 'MyTube reads dates in English and Portuguese only. With your YouTube account in another language, new videos cannot be detected.',
    'pt-BR': 'O MyTube lê datas só em inglês e português. Com sua conta do YouTube em outro idioma, não dá para detectar vídeos novos.',
  },

  'ai.sectionTitle': { en: 'AI', 'pt-BR': 'IA' },
  'ai.useThis': { en: 'Use this provider', 'pt-BR': 'Usar este provedor' },

  // Categorização por IA (Library)
  'cat.button': { en: 'Sort with AI', 'pt-BR': 'Organizar com IA' },
  'cat.title': { en: 'AI suggestions', 'pt-BR': 'Sugestões da IA' },
  'cat.scopeSelected': { en: 'selected items', 'pt-BR': 'itens selecionados' },
  'cat.scopeUnassigned': { en: 'items with no folder', 'pt-BR': 'itens sem pasta' },
  'cat.running': { en: 'Analyzing', 'pt-BR': 'Analisando' },
  'cat.of': { en: 'of', 'pt-BR': 'de' },
  'cat.slowHint': {
    en: 'Each batch is one call to the model — 30 to 90 seconds is normal.',
    'pt-BR': 'Cada lote é uma chamada ao modelo — 30 a 90 segundos é normal.',
  },
  'cat.none': {
    en: 'The AI returned no usable suggestion. Try again or pick another model.',
    'pt-BR': 'A IA não devolveu nenhuma sugestão aproveitável. Tente de novo ou escolha outro modelo.',
  },
  'cat.newTag': { en: 'new', 'pt-BR': 'nova' },
  'cat.willMove': { en: 'will be moved', 'pt-BR': 'serão movidos' },
  'cat.apply': { en: 'Apply', 'pt-BR': 'Aplicar' },
  'cat.applying': { en: 'Applying…', 'pt-BR': 'Aplicando…' },
  'cat.retry': { en: 'Run again', 'pt-BR': 'Rodar de novo' },
  'cat.selectAll': { en: 'Select all', 'pt-BR': 'Marcar tudo' },
  'cat.deselectAll': { en: 'Deselect all', 'pt-BR': 'Desmarcar tudo' },
  'cat.selectedCount': { en: 'selected', 'pt-BR': 'marcados' },
  'cat.acceptSelected': { en: 'Accept selected', 'pt-BR': 'Aceitar marcados' },
  'cat.acceptAll': { en: 'Accept all', 'pt-BR': 'Aceitar tudo' },
  'cat.foldersWord': { en: 'folders', 'pt-BR': 'pastas' },
  'cat.itemsWord': { en: 'items', 'pt-BR': 'itens' },
  'cat.skipped': { en: 'left out', 'pt-BR': 'de fora' },
  'cat.moveTo': { en: 'Move to', 'pt-BR': 'Mover para' },
  'cat.by': { en: 'by', 'pt-BR': 'por' },
  'cat.summary': { en: 'Where everything is going', 'pt-BR': 'Para onde tudo vai' },
  'cat.errNoProvider': {
    en: 'No AI connected. Open Settings → AI and connect one.',
    'pt-BR': 'Nenhuma IA conectada. Abra Configurações → IA e conecte uma.',
  },
  'cat.errNoModel': {
    en: 'The active provider has no model. Open Settings → AI, test it and pick a model.',
    'pt-BR': 'O provedor ativo está sem modelo. Abra Configurações → IA, teste e escolha um modelo.',
  },
} as const

type TranslationKey = keyof typeof translations

export const I18nContext = createContext<Language>('en')

export function useT(): (key: TranslationKey) => string {
  const lang = useContext(I18nContext)
  return (key: TranslationKey) => translations[key][lang] ?? translations[key]['en']
}

export type { TranslationKey }

export async function getLanguage(): Promise<Language> {
  const result = await chrome.storage.local.get('mytube-language')
  return (result['mytube-language'] as Language) || 'en'
}

export function t(key: TranslationKey, lang: Language): string {
  return translations[key][lang] ?? translations[key]['en']
}
