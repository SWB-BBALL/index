(function () {
  "use strict";

  var SETTINGS_KEY = "leagueSiteSettings";

  function getSettings() {
    try {
      return JSON.parse(window.localStorage.getItem(SETTINGS_KEY) || "{}") || {};
    } catch (error) {
      return {};
    }
  }

  function isClassic() {
    return getSettings().playerPageDestination === "classic";
  }

  function getPlayerFileFromUrl(url) {
    var str = String(url || "");
    var match = str.match(/(?:^|\/)(player\d+\.htm)(?:$|[?#])/i);
    if (match) {
      return match[1].toLowerCase();
    }
    var idMatch = str.match(/[?&]id=(player\d+)(?:&|#|$)/i);
    if (idMatch) {
      return idMatch[1].toLowerCase() + ".htm";
    }
    return "";
  }

  function isRewriteEligibleHref(href) {
    var h = String(href || "").toLowerCase();
    return Boolean(getPlayerFileFromUrl(href)) && h.indexOf("unified-player") === -1 && h.indexOf("id=player") === -1;
  }

  /**
   * Resolve a legacy roster-style player URL from pages under 00-assets/html/
   * (e.g. ../players/player698.htm) to either classic disk paths or unified-player.htm.
   */
  function hrefFromAssetsHtml(playerUrl) {
    var raw = String(playerUrl || "").trim();
    if (!raw) {
      return "#";
    }
    if (isClassic()) {
      var clean = raw.replace(/^(\.\/|\.\.\/)+/, "");
      return clean ? "../../" + clean : "#";
    }
    var m = raw.match(/player(\d+)\.htm/i);
    if (m) {
      return "./unified-player.htm?id=" + encodeURIComponent("player" + m[1]);
    }
    return "#";
  }

  function unifiedHrefByNameFromAssetsHtml(name) {
    return "./unified-player.htm?name=" + encodeURIComponent(name || "");
  }

  window.leaguePlayerPageLinks = {
    getSettings: getSettings,
    isClassic: isClassic,
    hrefFromAssetsHtml: hrefFromAssetsHtml,
    unifiedHrefByNameFromAssetsHtml: unifiedHrefByNameFromAssetsHtml,
    isRewriteEligibleHref: isRewriteEligibleHref
  };
})();
