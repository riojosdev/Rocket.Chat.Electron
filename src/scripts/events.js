import { ipcRenderer, remote } from 'electron';
import servers from './servers';
import sidebar from './sidebar';
import webview from './webview';

const { app, getCurrentWindow, shell } = remote;
const { certificate, menus, showAboutDialog, tray } = remote.require('./background');

const updateTrayIconState = ({ status, badgeText } = {}) => {
	const svg = document.querySelector('#tray-icon');

	const template = process.platform === 'darwin';

	svg.querySelector('.logo .baloon').style.fill = template ? '#FFFFFF' : '#DB2323';
	svg.querySelector('.logo .circles').style.fill = template ? '#FFFFFF' : '#DB2323';
	svg.querySelector('.status .away').style.fill = template ? '#FFFFFF' : '#DB2323';
	svg.querySelector('.status .busy').style.fill = template ? '#FFFFFF' : '#DB2323';

	svg.querySelector('.logo .bubble').style.display = template ? 'none' : null;

	svg.querySelector('.logo .circles').style.filter = template ? null : 'url(#tray-icon-dropshadow)';
	svg.querySelector('.badge circle').style.filter = template ? null : 'url(#tray-icon-dropshadow)';
	svg.querySelector('.status circle').style.filter = template ? null : 'url(#tray-icon-dropshadow)';

	svg.querySelector('.badge').style.display = (!template && badgeText) ? null : 'none';
	svg.querySelector('.badge text').innerHTML = badgeText;

	svg.querySelector('.logo .circles').style.display = (template && status !== 'online') ? 'none' : '';
	svg.querySelector('.status circle').style.display = (template || !status) ? 'none' : null;
	svg.querySelector('.status .away').style.display = (template && status === 'away') ? null : 'none';
	svg.querySelector('.status .busy').style.display = (template && status === 'busy') ? null : 'none';
	svg.querySelector('.status circle').style.fill = {
		offline: null,
		away: 'yellow',
		busy: 'red',
		online: 'lime',
	}[status];
};

const rasterizeTrayIcon = async(size) => {
	const svg = document.querySelector('#tray-icon');

	const image = new Image();
	image.src = `data:image/svg+xml,${ encodeURIComponent(svg.outerHTML) }`;
	image.width = image.height = size;
	await new Promise((resolve, reject) => {
		image.onload = resolve;
		image.onerror = reject;
	});

	const canvas = document.createElement('canvas');
	canvas.width = canvas.height = size;

	const ctx = canvas.getContext('2d');
	ctx.drawImage(image, 0, 0);

	return canvas.toDataURL();
};

export default () => {
	menus.on('quit', () => app.quit());
	menus.on('about', () => showAboutDialog());
	menus.on('open-url', (url) => shell.openExternal(url));


	menus.on('add-new-server', () => {
		getCurrentWindow().show();
		servers.clearActive();
		webview.showLanding();
	});

	menus.on('select-server', ({ url }) => {
		getCurrentWindow().show();
		servers.setActive(url);
	});

	menus.on('reload-server', ({ ignoringCache = false, clearCertificates = false } = {}) => {
		if (clearCertificates) {
			certificate.clear();
		}

		const activeWebview = webview.getActive();
		if (!activeWebview) {
			return;
		}

		if (ignoringCache) {
			activeWebview.reloadIgnoringCache();
			return;
		}

		activeWebview.reload();
	});

	menus.on('open-devtools-for-server', () => {
		const activeWebview = webview.getActive();
		if (activeWebview) {
			activeWebview.openDevTools();
		}
	});


	menus.on('go-back', () => webview.goBack());
	menus.on('go-forward', () => webview.goForward());


	menus.on('reload-app', () => {
		const mainWindow = getCurrentWindow();
		mainWindow.removeAllListeners();
		menus.removeAllListeners();
		tray.destroy();
		mainWindow.reload();
	});

	menus.on('toggle-devtools', () => getCurrentWindow().toggleDevTools());

	menus.on('reset-app-data', () => servers.resetAppData());


	const updatePreferences = () => {
		const mainWindow = getCurrentWindow();

		menus.setState({
			showTrayIcon: localStorage.getItem('hideTray') ?
				localStorage.getItem('hideTray') !== 'true' : (process.platform !== 'linux'),
			showUserStatusInTray: (localStorage.getItem('showUserStatusInTray') || 'true') === 'true',
			showFullScreen: mainWindow.isFullScreen(),
			showWindowOnUnreadChanged: localStorage.getItem('showWindowOnUnreadChanged') === 'true',
			showMenuBar: localStorage.getItem('autohideMenu') !== 'true',
			showServerList: localStorage.getItem('sidebar-closed') !== 'true',
		});

		tray.setState({
			showIcon: localStorage.getItem('hideTray') ?
				localStorage.getItem('hideTray') !== 'true' : (process.platform !== 'linux'),
			showUserStatus: (localStorage.getItem('showUserStatusInTray') || 'true') === 'true',
		});
	};

	menus.on('toggle', (property) => {
		switch (property) {
			case 'showTrayIcon': {
				const previousValue = localStorage.getItem('hideTray') !== 'true';
				const newValue = !previousValue;
				localStorage.setItem('hideTray', JSON.stringify(!newValue));
				break;
			}

			case 'showUserStatusInTray': {
				const previousValue = (localStorage.getItem('showUserStatusInTray') || 'true') === 'true';
				const newValue = !previousValue;
				localStorage.setItem('showUserStatusInTray', JSON.stringify(newValue));
				break;
			}

			case 'showFullScreen': {
				const mainWindow = getCurrentWindow();
				mainWindow.setFullScreen(!mainWindow.isFullScreen());
				break;
			}

			case 'showWindowOnUnreadChanged': {
				const previousValue = localStorage.getItem('showWindowOnUnreadChanged') === 'true';
				const newValue = !previousValue;
				localStorage.setItem('showWindowOnUnreadChanged', JSON.stringify(newValue));
				break;
			}

			case 'showMenuBar': {
				const previousValue = localStorage.getItem('autohideMenu') !== 'true';
				const newValue = !previousValue;
				localStorage.setItem('autohideMenu', JSON.stringify(!newValue));
				break;
			}

			case 'showServerList': {
				sidebar.toggle();
				break;
			}
		}

		updatePreferences();
	});

	const updateServers = () => {
		menus.setState({
			servers: Object.values(servers.hosts)
				.sort((a, b) => (sidebar ? (sidebar.sortOrder.indexOf(a.url) - sidebar.sortOrder.indexOf(b.url)) : 0))
				.map(({ title, url }) => ({ title, url })),
			currentServerUrl: servers.active,
		});
	};

	servers.on('loaded', updateServers);
	servers.on('active-cleared', updateServers);
	servers.on('active-setted', updateServers);
	servers.on('host-added', updateServers);
	servers.on('host-removed', updateServers);
	servers.on('title-setted', updateServers);
	sidebar.on('hosts-sorted', updateServers);


	sidebar.on('badge-setted', () => {
		const badge = sidebar.getGlobalBadge();
		const hasMentions = badge.showAlert && badge.count > 0;
		const mainWindow = getCurrentWindow();

		tray.setState({ badge });

		if (!mainWindow.isFocused()) {
			mainWindow.flashFrame(hasMentions);
		}

		if (process.platform === 'win32') {
			if (hasMentions) {
				mainWindow.webContents.send('render-taskbar-icon', badge.count);
			} else {
				mainWindow.setOverlayIcon(null, '');
			}
		}

		if (process.platform === 'darwin') {
			app.dock.setBadge(badge.title);
		}

		if (process.platform === 'linux') {
			app.setBadgeCount(badge.count);
		}
	});


	const updateWindowState = () =>
		tray.setState({ isMainWindowVisible: getCurrentWindow().isVisible() });
	getCurrentWindow().on('hide', updateWindowState);
	getCurrentWindow().on('show', updateWindowState);

	tray.on('created', () => getCurrentWindow().emit('tray-created'));
	tray.on('destroyed', () => getCurrentWindow().emit('tray-destroyed'));
	tray.on('render-icon', async(style) => {
		updateTrayIconState(style);
		const pixelRatio = window.devicePixelRatio;
		const iconSize = (process.platform === 'win32' ? 16 : 24) * pixelRatio;
		const dataUrl = await rasterizeTrayIcon(iconSize);
		tray.emit('rendered-icon', { dataUrl, pixelRatio });
	});
	tray.on('set-main-window-visibility', (visible) =>
		(visible ? getCurrentWindow().show() : getCurrentWindow().hide()));
	tray.on('quit', () => app.quit());


	webview.on('ipc-message-unread-changed', (hostUrl, [count]) => {
		if (typeof count === 'number' && localStorage.getItem('showWindowOnUnreadChanged') === 'true') {
			const mainWindow = remote.getCurrentWindow();
			if (!mainWindow.isFocused()) {
				mainWindow.once('focus', () => mainWindow.flashFrame(false));
				mainWindow.showInactive();
				mainWindow.flashFrame(true);
			}
		}
	});

	webview.on('ipc-message-user-status-manually-set', (hostUrl, [status]) => {
		tray.setState({ status });
	});

	ipcRenderer.on('render-taskbar-icon', (event, messageCount) => {
		// Create a canvas from unread messages
		function createOverlayIcon(messageCount) {
			const canvas = document.createElement('canvas');
			canvas.height = 128;
			canvas.width = 128;

			const ctx = canvas.getContext('2d');
			ctx.beginPath();

			ctx.fillStyle = 'red';
			ctx.arc(64, 64, 64, 0, 2 * Math.PI);
			ctx.fill();
			ctx.fillStyle = '#ffffff';
			ctx.textAlign = 'center';
			canvas.style.letterSpacing = '-4px';
			ctx.font = 'bold 92px sans-serif';
			ctx.fillText(String(Math.min(99, messageCount)), 64, 98);

			return canvas;
		}

		ipcRenderer.send('update-taskbar-icon', createOverlayIcon(messageCount).toDataURL(), String(messageCount));
	});


	servers.restoreActive();
	updatePreferences();
	updateServers();
	updateWindowState();

};
