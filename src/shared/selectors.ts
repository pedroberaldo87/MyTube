export const YT = {
  videoTitle: 'h1.ytd-watch-metadata yt-formatted-string, h1.ytd-video-primary-info-renderer yt-formatted-string',
  channelName: 'ytd-channel-name yt-formatted-string a, #channel-name yt-formatted-string a',
  channelLink: 'ytd-channel-name yt-formatted-string a, #channel-name a',
  channelAvatar: '#owner #avatar img, ytd-video-owner-renderer #avatar img',

  channelPageName: '#channel-header ytd-channel-name yt-formatted-string, #channel-name yt-formatted-string',
  channelPageAvatar: '#channel-header-container #avatar img, #channel-header #avatar img',
  channelSubscribeButton: '#subscribe-button, ytd-subscribe-button-renderer',

  playlistTitle: 'ytd-playlist-header-renderer h1 yt-formatted-string, .metadata-wrapper yt-formatted-string',
  playlistOwner: 'ytd-playlist-header-renderer .metadata-owner yt-formatted-string a',
  playlistThumbnail: 'ytd-playlist-header-renderer ytd-playlist-thumbnail img',

  subscriptionItem: 'ytd-channel-renderer, ytd-grid-channel-renderer, ytd-rich-item-renderer:has(ytd-channel-renderer), yt-lockup-view-model',
  subscriptionItemName: '#channel-info #text, #info #text, .yt-lockup-metadata-view-model-wiz__title',
  subscriptionItemLink: '#channel-info a, #main-link, a.yt-lockup-metadata-view-model-wiz__title',
  subscriptionItemAvatar: '#avatar img, #img img, .yt-lockup-view-model-wiz__content-image img',

  playlistItem: 'ytd-playlist-renderer, ytd-grid-playlist-renderer, ytd-rich-item-renderer:has(ytd-playlist-renderer), ytd-item-section-renderer ytd-shelf-renderer',
  playlistItemTitle: '#video-title, h3 a, #meta h3 yt-formatted-string, [id="video-title"]',
  playlistItemLink: 'a#thumbnail, #video-title a, h3 a, a[href*="list="]',
  playlistItemThumbnail: '#thumbnail img, ytd-thumbnail img, ytd-playlist-thumbnail img',

  isDarkTheme: 'html[dark]',
} as const

export function $(selector: string, parent: ParentNode = document): Element | null {
  return parent.querySelector(selector)
}

export function $$(selector: string, parent: ParentNode = document): Element[] {
  return Array.from(parent.querySelectorAll(selector))
}

export function isDarkMode(): boolean {
  return document.querySelector(YT.isDarkTheme) !== null
}
