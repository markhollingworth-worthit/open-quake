    window.openQuakeChatRuntimeConfig = {};
    window.openQuakeChatConfig = async function () {
      try {
        var r = await fetch('/app-config?app=chat', { cache: 'no-store' });
        if (!r.ok) return window.openQuakeChatRuntimeConfig;
        var data = await r.json();
        var opts = (data && data.options) || {};
        window.openQuakeChatRuntimeConfig = {
          endpoint: opts.endpoint || '',
          apiKey: opts.api_key || '',
          model: opts.model || ''
        };
      } catch (e) {
        window.openQuakeChatRuntimeConfig = {};
      }
      return window.openQuakeChatRuntimeConfig;
    };
