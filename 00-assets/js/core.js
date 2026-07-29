(function () {
  "use strict";

  var SETTINGS_KEY = "leagueSiteSettings";
  var SITE_CONFIG = window.LeagueSiteConfig || {};
  var LEAGUE_CONFIG = SITE_CONFIG.league || {};
  var FEATURE_CONFIG = SITE_CONFIG.features || {};
  var TEAM_CONFIG = SITE_CONFIG.teams || {};
  var DEFAULT_VIEWPORT = "width=device-width, initial-scale=1.0, minimum-scale=1.0, maximum-scale=5.0, user-scalable=yes";
  var ROSTER_VIEWPORT = "width=500, initial-scale=1.0, minimum-scale=0.85, maximum-scale=5.0, user-scalable=yes";
  var SITE_ROOT_PATH = getSiteRootPath();
  var jsonPromiseCache = {};
  var ABSOLUTE_PATHS = {
    depthCharts: toSitePath("00-assets/html/depthcharts.htm"),
    camps: toSitePath("00-assets/html/camps.htm"),
    faWarRoom: toSitePath("00-assets/html/fa-war-room.htm"),
    playerDatabase: toSitePath("00-assets/html/player-database.htm"),
    playerCompare: toSitePath("00-assets/html/player-compare.htm"),
    matchCentre: toSitePath("00-assets/html/match-centre.htm"),
    matchPreview: toSitePath("00-assets/html/match-centre.htm"),
    unifiedBoxScore: toSitePath("00-assets/html/match-centre.htm"),
    tradeTool: toSitePath("00-assets/html/trade-tool.htm"),
    trainingCamp: toSitePath("00-assets/html/training-camp.htm"),
    unifiedLeaders: toSitePath("00-assets/html/unified-leaders.htm"),
    unifiedStandings: toSitePath("00-assets/html/unified-standings.htm"),
    unifiedTeamLeaders: toSitePath("00-assets/html/unified-team-leaders.htm"),
    settings: toSitePath("00-assets/html/settings.htm"),
    mainIndex: toSitePath("index.htm"),
    leagueRules: toSitePath("00-assets/html/league-rules.htm"),
    leagueDashboard: toSitePath("standings.htm"),
    leagueLogo: toSitePath(LEAGUE_CONFIG.logo || "00-assets/branding/league-logo.png")
  };

  function isFeatureEnabled(name) {
    return FEATURE_CONFIG[name] === true;
  }

  function showRatingNumbers() {
    return !SITE_CONFIG.presentation || SITE_CONFIG.presentation.showOverallPotentialNumbers !== false;
  }

  function sanitizeRatingNumbers(root) {
    if (showRatingNumbers()) return;
    var scope = root || document;
    document.documentElement.classList.add("league-rating-numbers-hidden");
    var tables = Array.prototype.slice.call(scope.querySelectorAll("table"));
    if (scope.matches && scope.matches("table")) tables.unshift(scope);
    tables.forEach(function (table) {
      var tableRows = Array.prototype.slice.call(table.rows || []);
      var header = tableRows.find(function (row) {
        return Array.prototype.slice.call(row.children).some(function (cell) {
          var label = String(cell.textContent || "").replace(/[^A-Za-z]/g, "").toUpperCase();
          return ["OVR", "POT", "CUR", "FUT"].indexOf(label) >= 0;
        });
      });
      if (!header) return;
      var indexes = [];
      Array.prototype.slice.call(header.children).forEach(function (cell, index) {
        var label = String(cell.textContent || "").replace(/[^A-Za-z]/g, "").toUpperCase();
        if (["OVR", "POT", "CUR", "FUT"].indexOf(label) >= 0) {
          indexes.push({ index: index, label: label === "POT" || label === "FUT" ? "Potential" : "Overall" });
          cell.style.cursor = "default";
          cell.style.userSelect = "";
          cell.setAttribute("aria-label", (label === "POT" || label === "FUT" ? "Potential" : "Overall") + " rating colour");
          Array.prototype.slice.call(cell.querySelectorAll("span")).forEach(function (arrow) {
            if (/^[\s^v]+$/i.test(String(arrow.textContent || ""))) arrow.remove();
          });
        }
      });
      tableRows.forEach(function (row) {
        if (row === header) return;
        indexes.forEach(function (ratingColumn) {
          var cell = row.children[ratingColumn.index];
          if (!cell) return;
          cell.removeAttribute("data-sort-value");
          cell.removeAttribute("title");
          Array.prototype.slice.call(cell.querySelectorAll("[title]")).forEach(function (child) {
            child.removeAttribute("title");
          });
          cell.setAttribute("aria-label", ratingColumn.label + " rating colour");
          Array.prototype.slice.call(cell.childNodes).forEach(function clear(node) {
            if (node.nodeType === 3) node.nodeValue = String(node.nodeValue || "").replace(/-?\d+(?:\.\d+)?/g, "");
            else Array.prototype.slice.call(node.childNodes || []).forEach(clear);
          });
        });
      });
    });
    Array.prototype.slice.call(scope.querySelectorAll(
      ".player-rating-pill,.db-rating,.fa-rating,[data-rating-value],.rating-chip"
    )).forEach(function (node) {
      var visibleLabel = String(node.textContent || "").toUpperCase();
      var ratingLabel = /\b(POT|FUT)\b/.test(visibleLabel) ? "Potential" : "Overall";
      node.removeAttribute("title");
      node.removeAttribute("data-rating-value");
      Array.prototype.slice.call(node.querySelectorAll("[title]")).forEach(function (child) {
        child.removeAttribute("title");
      });
      node.setAttribute("aria-label", ratingLabel + " rating colour");
      Array.prototype.slice.call(node.childNodes).forEach(function clear(child) {
        if (child.nodeType === 3) child.nodeValue = String(child.nodeValue || "").replace(/-?\d+(?:\.\d+)?/g, "");
        else Array.prototype.slice.call(child.childNodes || []).forEach(clear);
      });
    });
  }

  function resolveTeam(value) {
    var raw = String(value || "").trim().toLowerCase();
    var match = null;
    Object.keys(TEAM_CONFIG).some(function (teamId) {
      var team = TEAM_CONFIG[teamId] || {};
      var aliases = [teamId, team.displayName, team.abbreviation].concat(team.aliases || []);
      if (aliases.some(function (alias) { return String(alias || "").toLowerCase() === raw; })) {
        match = Object.assign({ id: teamId }, team);
        return true;
      }
      return false;
    });
    return match;
  }

  function teamDisplayName(value) {
    var team = resolveTeam(value);
    return team ? team.displayName : String(value || "");
  }

  function teamAbbreviation(value) {
    var team = resolveTeam(value);
    return team ? team.abbreviation : String(value || "").replace(/[^A-Za-z0-9]/g, "").slice(0, 3).toUpperCase();
  }

  function teamColour(value) {
    var team = resolveTeam(value);
    return team ? team.primary : ((SITE_CONFIG.theme || {}).primary || "#12355B");
  }

  function teamLogo(value) {
    var team = resolveTeam(value);
    return team && team.publicLogo ? toSitePath(team.publicLogo) : "";
  }

  function getSiteRootPath() {
    var path = String(window.location.pathname || "").replace(/\\/g, "/");
    var markers = [
      "/00-assets/",
      "/players/",
      "/rosters/",
      "/boxes/"
    ];
    var index = -1;
    var i;

    for (i = 0; i < markers.length; i += 1) {
      index = path.toLowerCase().indexOf(markers[i].toLowerCase());
      if (index >= 0) {
        return index > 0 ? path.slice(0, index) : "";
      }
    }

    index = path.lastIndexOf("/");
    return index > 0 ? path.slice(0, index) : "";
  }

  function toSitePath(relativePath) {
    var cleanPath = String(relativePath || "").replace(/^\/+/, "");
    return (SITE_ROOT_PATH ? SITE_ROOT_PATH + "/" : "/") + cleanPath;
  }

  function getSettings() {
    try {
      return JSON.parse(window.localStorage.getItem(SETTINGS_KEY) || "{}") || {};
    } catch (error) {
      return {};
    }
  }

  function saveSettings(settings) {
    window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings || {}));
  }

  if (!showRatingNumbers()) {
    document.documentElement.classList.add("league-rating-numbers-hidden");
    document.addEventListener("DOMContentLoaded", function () {
      sanitizeRatingNumbers(document);
      new MutationObserver(function (records) {
        records.forEach(function (record) {
          Array.prototype.slice.call(record.addedNodes || []).forEach(function (node) {
            if (node.nodeType !== 1) return;
            sanitizeRatingNumbers(node);
            var table = node.closest && node.closest("table");
            if (table) sanitizeRatingNumbers(table);
          });
        });
      }).observe(document.body, { childList: true, subtree: true });
    });
  }

  function ensureViewport(content) {
    var viewport = document.querySelector('meta[name="viewport"]');

    if (!viewport) {
      viewport = document.createElement("meta");
      viewport.name = "viewport";
      document.head.appendChild(viewport);
    }

    viewport.setAttribute("content", content);
  }

  function isNestedPage() {
    return /\/(players|rosters|boxes)\//i.test(window.location.pathname);
  }

  function isAssetHtmlPage() {
    return /\/00-assets\/html\//i.test(window.location.pathname) || /\\00-assets\\html\\/i.test(window.location.pathname);
  }

  function getBuildJsonPath(filename) {
    if (isNestedPage()) {
      return "../00-build/database/" + filename;
    }

    if (isAssetHtmlPage()) {
      return "../../00-build/database/" + filename;
    }

    return "00-build/database/" + filename;
  }

  function normalizePlayerUrl(url) {
    if (!url) {
      return "#";
    }

    if (!isNestedPage() && url.indexOf("../") === 0) {
      return "./" + url.slice(3);
    }

    return url;
  }

  function normalizeRosterUrl(url) {
    return normalizePlayerUrl(url);
  }

  function loadJsonData(filename) {
    if (!jsonPromiseCache[filename]) {
      var jsonPath = getBuildJsonPath(filename);
      jsonPromiseCache[filename] = fetch(jsonPath)
        .then(function (response) {
          if (!response.ok) {
            throw new Error("Failed to load " + filename);
          }
          return response.json();
        })
        .catch(function () {
          return loadJsonDataFromFrame(jsonPath);
        });
    }

    return jsonPromiseCache[filename];
  }

  function loadJsonDataFromFrame(jsonPath) {
    return new Promise(function (resolve, reject) {
      var frame = document.createElement("iframe");
      frame.hidden = true;
      frame.setAttribute("aria-hidden", "true");
      frame.src = jsonPath;

      frame.addEventListener("load", function () {
        try {
          var frameDocument = frame.contentDocument || frame.contentWindow.document;
          var raw = "";

          if (frameDocument) {
            if (frameDocument.body && frameDocument.body.textContent) {
              raw = frameDocument.body.textContent;
            }

            if (!raw && frameDocument.documentElement && frameDocument.documentElement.textContent) {
              raw = frameDocument.documentElement.textContent;
            }

            if (!raw) {
              var pre = frameDocument.querySelector("pre");
              raw = pre && pre.textContent ? pre.textContent : "";
            }
          }

          frame.remove();
          raw = String(raw || "").replace(/^\uFEFF/, "").trim();

          if (!raw) {
            reject(new Error("No player data found"));
            return;
          }

          resolve(JSON.parse(raw));
        } catch (error) {
          frame.remove();
          reject(error);
        }
      });

      frame.addEventListener("error", function () {
        frame.remove();
        reject(new Error("Unable to load player data"));
      });

      document.body.appendChild(frame);
    });
  }

  function shouldAttachStandingsSearch() {
    return /\/standings\.htm$/i.test(window.location.pathname) || /\\standings\.htm$/i.test(window.location.pathname);
  }

  function isWaiverWirePage() {
    return /\/waiverwire\.htm$/i.test(window.location.pathname) || /\\waiverwire\.htm$/i.test(window.location.pathname);
  }

  function isMenuPage() {
    return /\/menu\.htm$/i.test(window.location.pathname) || /\\menu\.htm$/i.test(window.location.pathname);
  }

  function isSettingsPage() {
    return /\/settings\.htm$/i.test(window.location.pathname) || /\\settings\.htm$/i.test(window.location.pathname);
  }

  function isSuperCupPage() {
    return false;
  }

  function usesSuperCupPlayerPages() {
    return false;
  }

  function isPlayerPage() {
    return /\/players\/player\d+\.htm$/i.test(window.location.pathname) || /\\players\\player\d+\.htm$/i.test(window.location.pathname);
  }

  function isRosterPage() {
    return /\/rosters\/roster\d+\.htm$/i.test(window.location.pathname) || /\\rosters\\roster\d+\.htm$/i.test(window.location.pathname);
  }

  function shouldUseLegacyViewport() {
    var path = window.location.pathname;
    var rootLegacyPagePattern = /\/(schedule|leaders|playoffleaders|teamleaders|transactions|injuries|freeagents|potentialfreeagents|capreport|draft|staff|awards|seasonawards|champs|humancoaches)\.htm$/i;
    var nestedLegacyPagePattern = /\/(players|boxes|coaches)\/.+\.htm$/i;
    var windowsRootLegacyPagePattern = /\\(schedule|leaders|playoffleaders|teamleaders|transactions|injuries|freeagents|potentialfreeagents|capreport|draft|staff|awards|seasonawards|champs|humancoaches)\.htm$/i;
    var windowsNestedLegacyPagePattern = /\\(players|boxes|coaches)\\.+\.htm$/i;

    return rootLegacyPagePattern.test(path) || nestedLegacyPagePattern.test(path) || windowsRootLegacyPagePattern.test(path) || windowsNestedLegacyPagePattern.test(path);
  }

  function enableMenuFrameScroll() {
    var menuFrame = document.querySelector('frame[name="Options"], iframe[name="Options"]');

    if (!menuFrame) {
      return;
    }

    menuFrame.setAttribute("scrolling", "auto");
    menuFrame.style.overflow = "auto";
  }

  function getParentShellDocument() {
    try {
      if (window.parent === window || !window.parent.document) {
        return null;
      }

      return window.parent.document.querySelector(".site-shell") ? window.parent.document : null;
    } catch (error) {
      return null;
    }
  }

  function setParentMenuOpen(isOpen) {
    var parentDocument = getParentShellDocument();

    if (!parentDocument || !parentDocument.body) {
      return;
    }

    parentDocument.body.classList.toggle("league-menu-open", !!isOpen);
  }

  function syncDataFrameMenuButton() {
    try {
      if (
        window.parent &&
        window.parent.frames &&
        window.parent.frames.data &&
        typeof window.parent.frames.data.__syncLeagueMenuButton === "function"
      ) {
        window.parent.frames.data.__syncLeagueMenuButton();
      }
    } catch (error) {
      return;
    }
  }

  function isParentMenuOpen() {
    var parentDocument = getParentShellDocument();

    if (!parentDocument || !parentDocument.body) {
      return false;
    }

    return parentDocument.body.classList.contains("league-menu-open");
  }

  function normalizeName(value) {
    return String(value || "").replace(/\s+/g, " ").trim().toLowerCase();
  }

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
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

  function getRosterFileFromUrl(url) {
    var str = String(url || "");
    var match = str.match(/(?:^|\/)(roster\d+\.htm)(?:$|[?#])/i);
    if (match) {
      return match[1].toLowerCase();
    }
    var fileMatch = str.match(/[?&]file=(roster\d+\.htm)(?:&|#|$)/i);
    if (fileMatch) {
      return fileMatch[1].toLowerCase();
    }
    return "";
  }

  function prefersClassicPlayerPages() {
    return getSettings().playerPageDestination === "classic";
  }

  function prefersClassicTeamPages() {
    return getSettings().teamPageDestination !== "unified";
  }

  function getUnifiedPlayerPageHref(id) {
    var pageName = "unified-player.htm";

    if (isAssetHtmlPage()) {
      return "./" + pageName + "?id=" + encodeURIComponent(id);
    }

    if (isNestedPage()) {
      return "../00-assets/html/" + pageName + "?id=" + encodeURIComponent(id);
    }

    return "./00-assets/html/" + pageName + "?id=" + encodeURIComponent(id);
  }

  function getPlayerPageUrl(url) {
    var raw = String(url || "");
    if (prefersClassicPlayerPages()) {
      var idFromUnified = raw.match(/[?&]id=(player\d+)(?:&|#|$)/i);
      if (idFromUnified) {
        return normalizePlayerUrl("../players/" + idFromUnified[1].toLowerCase() + ".htm");
      }
      return normalizePlayerUrl(raw);
    }

    var file = getPlayerFileFromUrl(url);
    var id = file ? file.replace(/\.htm$/i, "") : "";

    if (!id) {
      return normalizePlayerUrl(url);
    }

    return getUnifiedPlayerPageHref(id);
  }

  function getUnifiedTeamPageHref(file) {
    var pageName = "unified-roster.htm";

    if (isAssetHtmlPage()) {
      return "./" + pageName + "?file=" + encodeURIComponent(file);
    }

    if (isNestedPage()) {
      return "../00-assets/html/" + pageName + "?file=" + encodeURIComponent(file);
    }

    return "./00-assets/html/" + pageName + "?file=" + encodeURIComponent(file);
  }

  function getTeamPageUrl(url) {
    var raw = String(url || "");
    if (prefersClassicTeamPages()) {
      var fileFromUnified = raw.match(/[?&]file=(roster\d+\.htm)(?:&|#|$)/i);
      if (fileFromUnified) {
        if (isAssetHtmlPage()) {
          return "../../rosters/" + fileFromUnified[1].toLowerCase();
        }
        return normalizeRosterUrl("../rosters/" + fileFromUnified[1].toLowerCase());
      }
      return normalizeRosterUrl(raw);
    }

    var file = getRosterFileFromUrl(url);
    if (!file) {
      return normalizeRosterUrl(url);
    }

    return getUnifiedTeamPageHref(file);
  }

  function buildTeamMap(teams) {
    return (teams || []).reduce(function (map, team) {
      if (team && team.id) {
        map[team.id] = team.name || team.id;
      }
      return map;
    }, {});
  }

  function enrichPlayers(players, teamMap) {
    return (players || []).map(function (player) {
      var copy = {};

      Object.keys(player || {}).forEach(function (key) {
        copy[key] = player[key];
      });

      copy.teamName = teamMap[player.team] || player.team || "";
      return copy;
    });
  }

  function renderResults(dropdown, matches, navigateToPlayer) {
    dropdown.innerHTML = "";

    if (!matches.length) {
      var empty = document.createElement("div");
      empty.className = "player-search__empty";
      empty.textContent = "No matching players";
      dropdown.appendChild(empty);
      dropdown.hidden = false;
      return;
    }

    matches.forEach(function (player) {
      var option = document.createElement("button");
      option.type = "button";
      option.className = "player-search__option";
      var metaBits = [player.teamName, player.pos ? player.pos : null, player.age ? "Age " + player.age : null].filter(Boolean);
      var submetaBits = [player.ht, player.wt ? player.wt + " lbs" : null].filter(Boolean);
      option.innerHTML =
        '<span class="player-search__name">' + escapeHtml(player.name) + "</span>" +
        '<span class="player-search__meta">' +
        escapeHtml(metaBits.join(" | ")) +
        "</span>";
      if (submetaBits.length) {
        option.innerHTML +=
          '<span class="player-search__submeta">' +
          escapeHtml(submetaBits.join(" | ")) +
          "</span>";
      }
      option.addEventListener("click", function () {
        navigateToPlayer(player);
      });
      dropdown.appendChild(option);
    });

    dropdown.hidden = false;
  }

  window.LeagueSiteCore = {
    SETTINGS_KEY: SETTINGS_KEY,
    DEFAULT_VIEWPORT: DEFAULT_VIEWPORT,
    ROSTER_VIEWPORT: ROSTER_VIEWPORT,
    paths: ABSOLUTE_PATHS,
    config: SITE_CONFIG,
    isFeatureEnabled: isFeatureEnabled,
    getSettings: getSettings,
    saveSettings: saveSettings,
    ensureViewport: ensureViewport,
    isNestedPage: isNestedPage,
    isAssetHtmlPage: isAssetHtmlPage,
    getBuildJsonPath: getBuildJsonPath,
    normalizePlayerUrl: normalizePlayerUrl,
    loadJsonData: loadJsonData,
    shouldAttachStandingsSearch: shouldAttachStandingsSearch,
    isWaiverWirePage: isWaiverWirePage,
    isMenuPage: isMenuPage,
    isSettingsPage: isSettingsPage,
    isSuperCupPage: isSuperCupPage,
    usesSuperCupPlayerPages: usesSuperCupPlayerPages,
    isPlayerPage: isPlayerPage,
    isRosterPage: isRosterPage,
    shouldUseLegacyViewport: shouldUseLegacyViewport,
    enableMenuFrameScroll: enableMenuFrameScroll,
    getParentShellDocument: getParentShellDocument,
    setParentMenuOpen: setParentMenuOpen,
    syncDataFrameMenuButton: syncDataFrameMenuButton,
    isParentMenuOpen: isParentMenuOpen,
    normalizeName: normalizeName,
    escapeHtml: escapeHtml,
    getPlayerFileFromUrl: getPlayerFileFromUrl,
    getRosterFileFromUrl: getRosterFileFromUrl,
    prefersClassicPlayerPages: prefersClassicPlayerPages,
    prefersClassicTeamPages: prefersClassicTeamPages,
    getPlayerPageUrl: getPlayerPageUrl,
    getTeamPageUrl: getTeamPageUrl,
    buildTeamMap: buildTeamMap,
    enrichPlayers: enrichPlayers,
    renderResults: renderResults,
    resolveTeam: resolveTeam,
    teamDisplayName: teamDisplayName,
    teamAbbreviation: teamAbbreviation,
    teamColour: teamColour,
    teamLogo: teamLogo
    ,showRatingNumbers: showRatingNumbers
    ,sanitizeRatingNumbers: sanitizeRatingNumbers
  };
})();
