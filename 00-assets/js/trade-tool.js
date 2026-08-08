(function () {
  "use strict";

  var core = window.LeagueSiteCore || null;
  var ESCAPE = core && core.escapeHtml ? core.escapeHtml : function (value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  };
  var SESSION_KEY = "league-trade-tool-state-v2";
  var TRADE_RULES = (core && core.config && core.config.rules && core.config.rules.trades) || {};
  var FINANCE_RULES = (core && core.config && core.config.rules && core.config.rules.finance) || {};
  var MAX_TEAMS = Number(TRADE_RULES.maxTeams || 4);
  var MAX_ROSTER_SIZE = Number(TRADE_RULES.maxRosterSize || 15);
  var SALARY_MATCH_PERCENT = Number(TRADE_RULES.salaryMatchPercent || 125);
  var SOFT_CAP_ENABLED = FINANCE_RULES.softCapEnabled === true;
  var TRADE_BACK_HOURS = Number(TRADE_RULES.tradeBackHours || 24);
  var MIN_TEAMS = 2;
  var PLAYERS_PATH = "../../00-build/database/players.json";
  var TEAMS_PATH = "../../00-build/database/teams.json";
  var CAPREPORT_PATH = "../../00-build/database/capreport.json";
  var STANDINGS_PATH = "../../00-build/database/standings.json";
  var CAP_RULES = {};
  var configuredTiers = (
    core && core.config && core.config.competitions && core.config.competitions.tiers
  ) || [];
  if (configuredTiers.length) {
    configuredTiers.forEach(function (tier) {
      CAP_RULES[String(tier.abbreviation || tier.id).toUpperCase()] = {
        label: tier.label,
        softCap: tier.salaryCap,
        hardCap: tier.hardCap,
        floor: tier.salaryFloor
      };
    });
  }
  var CUT_SALARY_LIMIT = 2380000;
  var TEAM_COLOR_FALLBACK = "#111b36";
  var state = {
    loaded: false,
    teams: [],
    players: [],
    rights: [],
    teamById: {},
    playerById: {},
    rightsById: {},
    teamColors: {},
    slots: ["", ""],
    offers: {},
    cuts: {},
    draggingAssetId: "",
    overrides: {
      players: {},
      rights: {}
    },
    searches: {}
  };

  function clean(value) {
    return String(value == null ? "" : value).replace(/\s+/g, " ").trim();
  }

  function normalizeName(value) {
    return clean(value).toLowerCase();
  }

  function slugify(value) {
    return clean(value).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  }

  function safeNumber(value) {
    var parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function formatMoney(value) {
    return "$" + Math.round(safeNumber(value)).toLocaleString("en-US");
  }

  function normalizeHexColor(value) {
    var match = String(value || "").match(/#([0-9a-f]{3}|[0-9a-f]{6})\b/i);

    if (!match) {
      return "";
    }

    var hex = match[1];
    if (hex.length === 3) {
      hex = hex.split("").map(function (character) {
        return character + character;
      }).join("");
    }

    return "#" + hex.toUpperCase();
  }

  function hexToRgb(hex) {
    var normalized = normalizeHexColor(hex).replace("#", "");

    return {
      r: parseInt(normalized.slice(0, 2), 16),
      g: parseInt(normalized.slice(2, 4), 16),
      b: parseInt(normalized.slice(4, 6), 16)
    };
  }

  function getContrastText(hex) {
    var color = hexToRgb(hex);
    var brightness = (color.r * 299 + color.g * 587 + color.b * 114) / 1000;

    return brightness > 150 ? "#0f172a" : "#f8fafc";
  }

  function loadJson(path) {
    if (core && core.loadJsonData && /00-build\/database\//.test(path)) {
      return core.loadJsonData(path.replace(/^.*00-build\/database\//, ""));
    }

    return fetch(path).then(function (response) {
      if (!response.ok) {
        throw new Error("Unable to load " + path);
      }
      return response.json();
    }).catch(function () {
      return loadJsonFromFrame(path);
    });
  }

  function loadJsonFromFrame(path) {
    return new Promise(function (resolve, reject) {
      var frame = document.createElement("iframe");
      frame.hidden = true;
      frame.setAttribute("aria-hidden", "true");
      frame.src = path;

      frame.addEventListener("load", function () {
        try {
          var doc = frame.contentDocument || frame.contentWindow.document;
          var raw = "";

          if (doc) {
            raw = (doc.body && doc.body.textContent) || (doc.documentElement && doc.documentElement.textContent) || "";
          }

          frame.remove();
          raw = String(raw || "").replace(/^\uFEFF/, "").trim();

          if (!raw) {
            reject(new Error("No JSON found at " + path));
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
        reject(new Error("Unable to load " + path));
      });

      document.body.appendChild(frame);
    });
  }

  function loadText(path) {
    return fetch(path).then(function (response) {
      if (!response.ok) {
        throw new Error("Unable to load " + path);
      }
      return response.text();
    }).catch(function () {
      return loadTextFromFrame(path);
    });
  }

  function loadTextFromFrame(path) {
    return new Promise(function (resolve, reject) {
      var frame = document.createElement("iframe");
      frame.hidden = true;
      frame.setAttribute("aria-hidden", "true");
      frame.src = path;

      frame.addEventListener("load", function () {
        try {
          var doc = frame.contentDocument || frame.contentWindow.document;
          var raw = doc && doc.documentElement ? doc.documentElement.innerHTML : "";
          frame.remove();

          if (!raw) {
            reject(new Error("No HTML found at " + path));
            return;
          }

          resolve(raw);
        } catch (error) {
          frame.remove();
          reject(error);
        }
      });

      frame.addEventListener("error", function () {
        frame.remove();
        reject(new Error("Unable to load " + path));
      });

      document.body.appendChild(frame);
    });
  }

  function extractTeamColor(html) {
    var patterns = [
      /td\.teamheader\s*\{[^}]*background\s*:\s*(#[0-9a-f]{3,6})/i,
      /td\.header\s*\{[^}]*background\s*:\s*(#[0-9a-f]{3,6})/i,
      /tr\.teamcolor\s*\{[^}]*background\s*:\s*(#[0-9a-f]{3,6})/i
    ];

    for (var index = 0; index < patterns.length; index += 1) {
      var match = String(html || "").match(patterns[index]);
      var color = match ? normalizeHexColor(match[1]) : "";

      if (color) {
        return color;
      }
    }

    return "";
  }

  function teamTierFromSection(section) {
    var slug = clean(section && section.slug).toLowerCase();
    var configured = configuredTiers.find(function (tier) {
      return slug.indexOf(String(tier.detectedLabel || tier.id).toLowerCase()) === 0 ||
        slug.indexOf(String(tier.id).toLowerCase()) === 0;
    });
    if (!configured && configuredTiers.length === 1) {
      configured = configuredTiers[0];
    }
    if (configured) return String(configured.abbreviation || configured.id).toUpperCase();
    return "";
  }

  function derivePlayerId(player) {
    var url = clean(player && player.url);
    var fileMatch = url.match(/player(\d+)\.htm/i);
    if (fileMatch) {
      return "player" + fileMatch[1];
    }
    return "player-" + slugify(player && player.name);
  }

  function deriveRightsId(teamName, playerName) {
    return "right-" + slugify(teamName + "-" + playerName);
  }

  function getOfficialTeamId(teamName, teamByName) {
    var exact = teamByName[clean(teamName)];
    return exact ? exact.id : "";
  }

  function saveSession() {
    try {
      window.sessionStorage.setItem(SESSION_KEY, JSON.stringify({
        slots: state.slots,
        offers: state.offers,
        cuts: state.cuts,
        overrides: state.overrides,
        searches: state.searches
      }));
    } catch (error) {
      // Ignore storage errors.
    }
  }

  function restoreSession() {
    var saved;
    try {
      saved = JSON.parse(window.sessionStorage.getItem(SESSION_KEY) || "{}");
    } catch (error) {
      saved = {};
    }

    if (Array.isArray(saved.slots) && saved.slots.length) {
      state.slots = saved.slots.slice(0, MAX_TEAMS);
      while (state.slots.length < MIN_TEAMS) {
        state.slots.push("");
      }
    }

    state.offers = saved.offers && typeof saved.offers === "object" ? saved.offers : {};
    state.cuts = saved.cuts && typeof saved.cuts === "object" ? saved.cuts : {};
    state.overrides = saved.overrides && typeof saved.overrides === "object" ? saved.overrides : { players: {}, rights: {} };
    state.searches = saved.searches && typeof saved.searches === "object" ? saved.searches : {};
  }

  function hasOwn(obj, key) {
    return Object.prototype.hasOwnProperty.call(obj || {}, key);
  }

  function getEffectivePlayerTeamId(playerId) {
    if (hasOwn(state.overrides.players, playerId)) {
      return state.overrides.players[playerId] || "";
    }
    return (state.playerById[playerId] && state.playerById[playerId].teamId) || "";
  }

  function getEffectiveRightsTeamId(rightsId) {
    if (hasOwn(state.overrides.rights, rightsId)) {
      return state.overrides.rights[rightsId] || "";
    }
    return (state.rightsById[rightsId] && state.rightsById[rightsId].teamId) || "";
  }

  function isOfficialTeamId(teamId) {
    return !!state.teamById[teamId];
  }

  function getParticipants() {
    var seen = {};
    return state.slots.filter(function (teamId) {
      if (!teamId || seen[teamId]) {
        return false;
      }
      seen[teamId] = true;
      return true;
    });
  }

  function getAutoDestinationTeamId(assetId) {
    var participants = getParticipants();
    var ownerTeamId = getAssetOwnerTeamId(assetId);

    if (participants.length !== 2 || !ownerTeamId) {
      return "";
    }

    if (participants.indexOf(ownerTeamId) === -1) {
      return "";
    }

    return participants[0] === ownerTeamId ? participants[1] : participants[0];
  }

  function assignDraggedAssetToTeam(assetId, targetTeamId) {
    var ownerTeamId = getAssetOwnerTeamId(assetId);

    if (!assetId || !targetTeamId || !state.teamById[targetTeamId] || !ownerTeamId || ownerTeamId === targetTeamId) {
      return false;
    }

    state.offers[assetId] = state.offers[assetId] || { toTeamId: "", recentTradeback: false };
    state.offers[assetId].toTeamId = targetTeamId;
    if (!Object.prototype.hasOwnProperty.call(state.offers[assetId], "recentTradeback")) {
      state.offers[assetId].recentTradeback = false;
    }
    return true;
  }

  function getVisibleTeamOptions(selectedTeamId) {
    return ['<option value="">Select team</option>'].concat(state.teams.map(function (team) {
      return '<option value="' + ESCAPE(team.id) + '"' + (team.id === selectedTeamId ? " selected" : "") + ">" + ESCAPE(team.name) + "</option>";
    })).join("");
  }

  function buildBaseData(results) {
    var players = results[0];
    var teams = results[1];
    var capreport = results[2];
    var standings = results[3];
    var teamByName = {};
    var standingsTierByTeam = {};
    var capEntriesByTeam = {};

    (teams || []).forEach(function (team) {
      teamByName[clean(team.name)] = team;
    });

    (standings && standings.sections || []).forEach(function (section) {
      var tier = teamTierFromSection(section);
      (section.teams || []).forEach(function (entry) {
        standingsTierByTeam[clean(entry.team)] = tier;
      });
    });

    (capreport && capreport.sections || []).forEach(function (section) {
      (section.entries || []).forEach(function (entry) {
        capEntriesByTeam[clean(entry.team)] = entry;
      });
    });

    state.teams = Object.keys(capEntriesByTeam).map(function (teamName) {
      var entry = capEntriesByTeam[teamName];
      var teamMeta = teamByName[teamName] || {};
      var tier = standingsTierByTeam[teamName] || "";
      var rules = CAP_RULES[tier] || { label: tier || "Unknown", softCap: 0, hardCap: 0, floor: 0 };
      var softCap = safeNumber(rules.softCap);
      var absoluteHardCap = safeNumber(rules.hardCap);
      return {
        id: teamMeta.id || clean(entry.rosterFile).replace(/\.htm$/i, ""),
        name: entry.team,
        rosterFile: entry.rosterFile,
        rosterUrl: entry.rosterUrl,
        tier: tier,
        tierLabel: rules.label,
        softCap: softCap,
        hardCap: absoluteHardCap || (SOFT_CAP_ENABLED ? 0 : softCap),
        floor: rules.floor,
        payroll: safeNumber(entry.salary),
        payrollText: entry.salaryText || formatMoney(entry.salary),
        capRoom: safeNumber(entry.capRoom),
        capRoomText: entry.capRoomText || formatMoney(entry.capRoom)
      };
    }).sort(function (a, b) {
      return a.name.localeCompare(b.name);
    });

    state.teamById = state.teams.reduce(function (map, team) {
      map[team.id] = team;
      return map;
    }, {});

    state.players = (players || []).map(function (player) {
      var teamId = isOfficialTeamId(player.team) ? player.team : getOfficialTeamId(player.teamLabel, teamByName);
      return {
        id: derivePlayerId(player),
        name: clean(player.name),
        url: clean(player.url),
        pos: clean(player.pos),
        age: clean(player.age),
        teamId: teamId,
        teamName: teamId && state.teamById[teamId] ? state.teamById[teamId].name : clean(player.teamLabel || player.team),
        currentSalary: safeNumber(player.currentSalary),
        currentSalaryText: player.currentSalaryText || formatMoney(player.currentSalary),
        raw: player
      };
    });

    state.playerById = state.players.reduce(function (map, player) {
      map[player.id] = player;
      return map;
    }, {});

    state.rights = [];

    state.rightsById = state.rights.reduce(function (map, asset) {
      map[asset.id] = asset;
      return map;
    }, {});
  }

  function loadTeamColors() {
    return Promise.all(state.teams.map(function (team) {
      var path = "../../rosters/" + team.rosterFile;
      return loadText(path).then(function (html) {
        state.teamColors[team.id] = extractTeamColor(html) || TEAM_COLOR_FALLBACK;
      }).catch(function () {
        state.teamColors[team.id] = TEAM_COLOR_FALLBACK;
      });
    }));
  }

  function getPlayerLink(player) {
    if (!player || !player.url) {
      return "";
    }
    if (core && core.getPlayerPageUrl) {
      return core.getPlayerPageUrl(player.url);
    }
    return player.url;
  }

  function getTeamAssets(teamId, searchTerm) {
    var needle = normalizeName(searchTerm);
    var playerAssets = state.players.filter(function (player) {
      return getEffectivePlayerTeamId(player.id) === teamId;
    }).sort(function (a, b) {
      return b.currentSalary - a.currentSalary || a.name.localeCompare(b.name);
    });
    var rightsAssets = state.rights.filter(function (asset) {
      return getEffectiveRightsTeamId(asset.id) === teamId;
    }).sort(function (a, b) {
      return a.name.localeCompare(b.name);
    });
    var allAssets = playerAssets.map(function (player) {
      return {
        id: player.id,
        type: "player",
        name: player.name,
        subtitle: [player.pos, player.age ? "Age " + player.age : "", player.currentSalaryText].filter(Boolean).join(" | "),
        amount: player.currentSalary,
        amountText: player.currentSalaryText,
        player: player
      };
    }).concat(rightsAssets.map(function (asset) {
      return {
        id: asset.id,
        type: "rights",
        name: asset.name,
        subtitle: ["Rights", asset.pos, asset.age ? "Age " + asset.age : ""].filter(Boolean).join(" | "),
        amount: 0,
        amountText: "$0",
        rights: asset
      };
    }));

    if (!needle) {
      return allAssets;
    }

    return allAssets.filter(function (asset) {
      return normalizeName(asset.name + " " + asset.subtitle).indexOf(needle) !== -1;
    });
  }

  function assetKind(assetId) {
    return String(assetId || "").indexOf("right-") === 0 ? "rights" : "player";
  }

  function getAssetOwnerTeamId(assetId) {
    return assetKind(assetId) === "rights" ? getEffectiveRightsTeamId(assetId) : getEffectivePlayerTeamId(assetId);
  }

  function getAssetLabel(assetId) {
    if (assetKind(assetId) === "rights") {
      return state.rightsById[assetId] ? state.rightsById[assetId].name : assetId;
    }
    return state.playerById[assetId] ? state.playerById[assetId].name : assetId;
  }

  function getOffer(assetId) {
    return state.offers[assetId] || null;
  }

  function isOverrideActive() {
    return Object.keys(state.overrides.players || {}).length > 0 || Object.keys(state.overrides.rights || {}).length > 0;
  }

  function clearInvalidState() {
    Object.keys(state.offers).forEach(function (assetId) {
      var ownerTeamId = getAssetOwnerTeamId(assetId);
      if (!ownerTeamId) {
        delete state.offers[assetId];
      }
    });

    Object.keys(state.cuts).forEach(function (teamId) {
      if (!state.cuts[teamId] || typeof state.cuts[teamId] !== "object") {
        delete state.cuts[teamId];
      }
    });
  }

  function removeTeamFromTradeState(teamId) {
    if (!teamId) {
      return;
    }

    Object.keys(state.offers).forEach(function (assetId) {
      var offer = state.offers[assetId] || {};
      var ownerTeamId = getAssetOwnerTeamId(assetId);

      if (ownerTeamId === teamId || offer.toTeamId === teamId) {
        delete state.offers[assetId];
      }
    });

    if (state.cuts[teamId]) {
      delete state.cuts[teamId];
    }
  }

  function evaluateTrade() {
    var participants = getParticipants();
    var selectedTeamCounts = {};
    var teamSummaries = {};
    var outgoingByTeam = {};
    var incomingByTeam = {};
    var errors = [];
    var warnings = [];
    var selectedTiers = {};

    state.slots.forEach(function (teamId) {
      if (!teamId) {
        return;
      }
      selectedTeamCounts[teamId] = (selectedTeamCounts[teamId] || 0) + 1;
    });

    Object.keys(selectedTeamCounts).forEach(function (teamId) {
      if (selectedTeamCounts[teamId] > 1) {
        errors.push(state.teamById[teamId].name + " is selected more than once.");
      }
    });

    if (participants.length < 2) {
      warnings.push("Select at least two teams to build a trade.");
    }

    if (participants.length > MAX_TEAMS) {
      errors.push("Trades are limited to four teams.");
    }

    participants.forEach(function (teamId) {
      var team = state.teamById[teamId];
      selectedTiers[team.tier] = true;
      teamSummaries[teamId] = {
        team: team,
        beforePlayers: state.players.filter(function (player) {
          return getEffectivePlayerTeamId(player.id) === teamId;
        }),
        beforeRights: state.rights.filter(function (asset) {
          return getEffectiveRightsTeamId(asset.id) === teamId;
        }),
        outgoingPlayers: [],
        incomingPlayers: [],
        outgoingRights: [],
        incomingRights: [],
        outgoingSalary: 0,
        incomingSalary: 0,
        cutSalary: 0,
        cuts: [],
        payrollBefore: 0,
        payrollAfterTrade: 0,
        payrollAfterCuts: 0,
        finalPlayers: [],
        rosterAfterTradeCount: 0,
        rosterAfterCutsCount: 0,
        floorGap: 0,
        capRoom: 0
      };
      teamSummaries[teamId].payrollBefore = teamSummaries[teamId].beforePlayers.reduce(function (sum, player) {
        return sum + safeNumber(player.currentSalary);
      }, 0);
    });

    Object.keys(state.offers).forEach(function (assetId) {
      var offer = state.offers[assetId] || {};
      var fromTeamId = getAssetOwnerTeamId(assetId);
      var toTeamId = offer.toTeamId || "";
      var assetType = assetKind(assetId);
      var assetObject = assetType === "rights" ? state.rightsById[assetId] : state.playerById[assetId];
      var assetName = assetObject ? assetObject.name : assetId;

      if (!fromTeamId) {
        errors.push(assetName + " is not assigned to an official team in the current local state.");
        return;
      }

      if (!toTeamId) {
        errors.push("Select a destination for " + assetName + ".");
        return;
      }

      if (!state.teamById[toTeamId]) {
        errors.push(assetName + " is targeting an invalid destination team.");
        return;
      }

      if (fromTeamId === toTeamId) {
        errors.push(assetName + " cannot be sent to the same team that already owns it.");
        return;
      }

      if (participants.indexOf(fromTeamId) === -1 || participants.indexOf(toTeamId) === -1) {
        errors.push(assetName + " must move between teams that are currently included in the trade.");
        return;
      }

      if (assetType === "player") {
        teamSummaries[fromTeamId].outgoingPlayers.push(assetObject);
        teamSummaries[toTeamId].incomingPlayers.push(assetObject);
        teamSummaries[fromTeamId].outgoingSalary += safeNumber(assetObject.currentSalary);
        teamSummaries[toTeamId].incomingSalary += safeNumber(assetObject.currentSalary);

        if (offer.recentTradeback) {
          errors.push(assetName + " cannot be traded back to " + state.teamById[toTeamId].name + " within " + TRADE_BACK_HOURS + " hours.");
        }
      } else {
        teamSummaries[fromTeamId].outgoingRights.push(assetObject);
        teamSummaries[toTeamId].incomingRights.push(assetObject);
      }
    });

    participants.forEach(function (teamId) {
      var summary = teamSummaries[teamId];
      var afterTradePlayers = summary.beforePlayers
        .filter(function (player) {
          return !summary.outgoingPlayers.some(function (outgoing) {
            return outgoing.id === player.id;
          });
        })
        .concat(summary.incomingPlayers);

      summary.rosterAfterTradeCount = afterTradePlayers.length;
      summary.payrollAfterTrade = summary.payrollBefore - summary.outgoingSalary + summary.incomingSalary;

      var teamCuts = state.cuts[teamId] || {};
      summary.cuts = afterTradePlayers.filter(function (player) {
        return !!teamCuts[player.id];
      });
      summary.cutSalary = summary.cuts.reduce(function (sum, player) {
        return sum + safeNumber(player.currentSalary);
      }, 0);
      summary.finalPlayers = afterTradePlayers.filter(function (player) {
        return !teamCuts[player.id];
      });
      summary.rosterAfterCutsCount = summary.finalPlayers.length;
      summary.payrollAfterCuts = summary.payrollAfterTrade - summary.cutSalary;
      var activeCap = SOFT_CAP_ENABLED
        ? summary.team.softCap
        : (summary.team.hardCap || summary.team.softCap);
      summary.capRoom = activeCap - summary.payrollAfterCuts;
      summary.floorGap = summary.payrollAfterCuts - summary.team.floor;

        if (SOFT_CAP_ENABLED && summary.team.hardCap > 0 &&
            summary.payrollAfterCuts > summary.team.hardCap) {
          errors.push(
            summary.team.name + " exceeds the absolute hard cap after the trade by " +
            formatMoney(summary.payrollAfterCuts - summary.team.hardCap) + "."
          );
        }

        if (SOFT_CAP_ENABLED && summary.team.softCap > 0) {
          var withinCap = summary.payrollAfterTrade <= summary.team.softCap;
          var maximumIncoming = summary.outgoingSalary * (SALARY_MATCH_PERCENT / 100);
          var salaryMatched = summary.incomingSalary <= maximumIncoming;
          if (!withinCap && !salaryMatched) {
            errors.push(
              summary.team.name + " is over the soft cap and may receive no more than " +
              formatMoney(maximumIncoming) + " (" + SALARY_MATCH_PERCENT +
              "% of " + formatMoney(summary.outgoingSalary) + " outgoing)."
            );
          }
        } else if (!SOFT_CAP_ENABLED && activeCap > 0 && summary.payrollAfterCuts > activeCap) {
          errors.push(summary.team.name + " exceeds the hard cap after the trade by " + formatMoney(summary.payrollAfterCuts - activeCap) + ".");
        }

        if (summary.team.floor > 0 && summary.payrollAfterCuts < summary.team.floor) {
          errors.push(summary.team.name + " falls below the salary floor after the trade by " + formatMoney(summary.team.floor - summary.payrollAfterCuts) + ".");
        }

        if (summary.rosterAfterCutsCount > MAX_ROSTER_SIZE) {
          errors.push(summary.team.name + " still has " + summary.rosterAfterCutsCount + " players after optional cuts and needs to cut or move " + (summary.rosterAfterCutsCount - MAX_ROSTER_SIZE) + " more.");
        }

      summary.cuts.forEach(function (player) {
        var cutFlags = teamCuts[player.id] || {};
        if (cutFlags.cutToFacilitate) {
          warnings.push(player.name + " is marked as a cut-to-facilitate case for " + summary.team.name + ". That team cannot re-sign him within 24 hours.");
        }
        if (cutFlags.tradedThenCutReturn) {
          warnings.push(player.name + " is marked as traded-then-cut. He cannot return to his original team until the next sim.");
        }
      });
    });

    if (isOverrideActive()) {
      warnings.push("Local roster overrides are active. Calculations are using the edited session state, not just the official site data.");
    }

    var hasAssets = Object.keys(state.offers).length > 0;
    var verdict = "idle";
    if (errors.length) {
      verdict = "invalid";
    } else if (hasAssets && warnings.length) {
      verdict = "review";
    } else if (hasAssets) {
      verdict = "valid";
    }

    return {
      participants: participants,
      teamSummaries: teamSummaries,
      errors: errors,
      warnings: warnings,
      hasAssets: hasAssets,
      verdict: verdict,
      isInterTier: Object.keys(selectedTiers).filter(Boolean).length > 1
    };
  }

  function buildSummaryText(evaluation) {
    var participantNames = evaluation.participants.map(function (teamId) {
      return state.teamById[teamId].name;
    });

    if (!participantNames.length) {
      return "";
    }

    var lines = [];
    lines.push(participantNames.join(" / ") + (evaluation.isInterTier ? " (INTER-TIER)" : ""));
    lines.push("");

    evaluation.participants.forEach(function (teamId) {
      var summary = evaluation.teamSummaries[teamId];
      var outgoingLines = summary.outgoingPlayers.map(function (player) {
        return player.name;
      }).concat(summary.outgoingRights.map(function (asset) {
        return "RIGHTS TO " + asset.name;
      }));

      if (!outgoingLines.length) {
        return;
      }

      lines.push(summary.team.name.toUpperCase() + " SENDS");
      outgoingLines.forEach(function (line) {
        lines.push(line);
      });
      lines.push("");
    });

    return lines.join("\n").trim();
  }

  function renderVerdict(evaluation) {
    var pill = document.getElementById("tradeVerdictPill");
    var override = document.getElementById("tradeOverrideStatus");
    var issueCounts = document.getElementById("tradeIssueCounts");
    var errorsList = document.getElementById("tradeErrorsList");
    var summaryOutput = document.getElementById("tradeSummaryOutput");
    var summaryTitleHint = document.getElementById("tradeSummaryTitleHint");

    pill.className = "trade-pill";
    if (evaluation.verdict === "invalid") {
      pill.classList.add("trade-pill--bad");
      pill.textContent = "Invalid";
    } else if (evaluation.verdict === "review") {
      pill.classList.add("trade-pill--warn");
      pill.textContent = "Warnings";
    } else if (evaluation.verdict === "valid") {
      pill.classList.add("trade-pill--good");
      pill.textContent = "Valid";
    } else {
      pill.textContent = "Build a Trade";
    }

    override.textContent = isOverrideActive() ? "Local Overrides Active" : "Official Site Data";
    issueCounts.textContent = evaluation.errors.length + " blocker" + (evaluation.errors.length === 1 ? "" : "s");
    errorsList.innerHTML = evaluation.errors.length ? evaluation.errors.map(function (message) {
      return "<li>" + ESCAPE(message) + "</li>";
    }).join("") : "<li>No blocking errors.</li>";

    summaryOutput.value = buildSummaryText(evaluation);
    summaryTitleHint.textContent = evaluation.isInterTier ? "Inter-Tier Title Applied" : "Discord Ready";
  }

  function renderOverrides() {
    var container = document.getElementById("tradeOverridesList");
    var rows = [];

    Object.keys(state.overrides.players || {}).forEach(function (playerId) {
      var player = state.playerById[playerId];
      var targetTeamId = state.overrides.players[playerId] || "";
      var targetLabel = targetTeamId && state.teamById[targetTeamId] ? state.teamById[targetTeamId].name : "Unassigned";
      rows.push(
        '<div class="trade-override-row">' +
          '<div class="trade-override-main">' +
            '<div>' +
              '<div class="trade-asset-title">' + ESCAPE(player ? player.name : playerId) + '</div>' +
              '<div class="trade-override-meta">Player override → ' + ESCAPE(targetLabel) + '</div>' +
            '</div>' +
            '<button class="trade-mini-btn trade-mini-btn--remove" type="button" data-clear-override="player" data-override-id="' + ESCAPE(playerId) + '">Clear</button>' +
          '</div>' +
        '</div>'
      );
    });

    Object.keys(state.overrides.rights || {}).forEach(function (rightsId) {
      var rights = state.rightsById[rightsId];
      var targetTeamId = state.overrides.rights[rightsId] || "";
      var targetLabel = targetTeamId && state.teamById[targetTeamId] ? state.teamById[targetTeamId].name : "Unassigned";
      rows.push(
        '<div class="trade-override-row">' +
          '<div class="trade-override-main">' +
            '<div>' +
              '<div class="trade-asset-title">RIGHTS TO ' + ESCAPE(rights ? rights.name : rightsId) + '</div>' +
              '<div class="trade-override-meta">Rights override → ' + ESCAPE(targetLabel) + '</div>' +
            '</div>' +
            '<button class="trade-mini-btn trade-mini-btn--remove" type="button" data-clear-override="rights" data-override-id="' + ESCAPE(rightsId) + '">Clear</button>' +
          '</div>' +
        '</div>'
      );
    });

    container.innerHTML = rows.length ? rows.join("") : '<div class="trade-empty">No local overrides are active.</div>';
    container.querySelectorAll("[data-clear-override]").forEach(function (button) {
      button.addEventListener("click", function () {
        var kind = button.getAttribute("data-clear-override");
        var overrideId = button.getAttribute("data-override-id");
        if (kind === "player") {
          delete state.overrides.players[overrideId];
        } else {
          delete state.overrides.rights[overrideId];
        }
        saveSession();
        rerender();
      });
    });
  }

  function renderTeamCards(evaluation) {
    var grid = document.getElementById("tradeGrid");
    grid.style.gridTemplateColumns = "repeat(" + state.slots.length + ", minmax(330px, 1fr))";
    grid.innerHTML = state.slots.map(function (teamId, index) {
      var team = teamId && state.teamById[teamId] ? state.teamById[teamId] : null;
      var summary = team ? evaluation.teamSummaries[teamId] : null;
      var search = state.searches[index] || "";
      var assets = team ? getTeamAssets(teamId, search) : [];
      var outgoingRows = team ? Object.keys(state.offers).filter(function (assetId) {
        return getAssetOwnerTeamId(assetId) === teamId;
      }) : [];
      var incomingRows = team ? Object.keys(state.offers).filter(function (assetId) {
        var offer = state.offers[assetId];
        return offer && offer.toTeamId === teamId;
      }) : [];
      var cutPlayers = summary ? summary.finalPlayers.concat(summary.cuts.filter(function (player) {
        return !summary.finalPlayers.some(function (finalPlayer) {
          return finalPlayer.id === player.id;
        });
      })).filter(function (player) {
        return safeNumber(player.currentSalary) < CUT_SALARY_LIMIT;
      }) : [];

      return (
        '<article class="trade-team-card" data-slot-index="' + index + '"' + (team ? ' data-drop-team="' + ESCAPE(team.id) + '"' : "") + '>' +
          '<div class="trade-team-card__head"' + (team ? ' style="background:' + ESCAPE(state.teamColors[team.id] || TEAM_COLOR_FALLBACK) + ';color:' + ESCAPE(getContrastText(state.teamColors[team.id] || TEAM_COLOR_FALLBACK)) + ';"' : '') + '>' +
            '<div class="trade-team-card__toolbar">' +
              '<h2 class="trade-team-card__title">Team ' + String.fromCharCode(65 + index) + '</h2>' +
              (state.slots.length > MIN_TEAMS ? '<button class="trade-mini-btn trade-mini-btn--remove" type="button" data-remove-slot="' + index + '">Remove</button>' : '') +
            '</div>' +
            '<select class="trade-select" data-team-select="' + index + '">' + getVisibleTeamOptions(teamId) + '</select>' +
            '<div class="trade-team-card__meta">' + ESCAPE(team ? team.tierLabel + " | " +
              (SOFT_CAP_ENABLED
                ? "Soft Cap " + formatMoney(team.softCap) + (team.hardCap > 0 ? " | Hard Cap " + formatMoney(team.hardCap) : "")
                : "Hard Cap " + formatMoney(team.hardCap || team.softCap)) +
              " | Floor " + formatMoney(team.floor) : "Choose a team to activate this trade column.") + '</div>' +
            (summary ? (
              '<div class="trade-header-stats">' +
                renderHeaderStat("Payroll", formatMoney(summary.payrollBefore), "Cap room " + formatMoney((SOFT_CAP_ENABLED ? summary.team.softCap : (summary.team.hardCap || summary.team.softCap)) - summary.payrollBefore)) +
                renderHeaderStat("Roster", String(summary.beforePlayers.length), (summary.beforeRights.length || 0) + " rights") +
                renderHeaderStat("Outgoing", formatMoney(summary.outgoingSalary), summary.outgoingPlayers.length + " players") +
                renderHeaderStat("Incoming", formatMoney(summary.incomingSalary), summary.incomingPlayers.length + " players") +
                renderHeaderStat("Post Pay", formatMoney(summary.payrollAfterCuts), "Floor buffer " + formatMoney(summary.floorGap)) +
                renderHeaderStat("Post Roster", String(summary.rosterAfterCutsCount), summary.cuts.length ? (summary.cuts.length + " cuts") : "No cuts") +
              '</div>'
            ) : "") +
          '</div>' +
          '<section class="trade-card-section">' +
            '<p class="trade-card-label">Roster & Rights</p>' +
            (team ? (
              '<div class="trade-search-row">' +
                '<input class="trade-input" data-team-search="' + index + '" placeholder="Filter assets" value="' + ESCAPE(search) + '">' +
                '<button class="trade-mini-btn" type="button" data-clear-search="' + index + '">Clear</button>' +
              '</div>' +
              '<div class="trade-asset-list">' +
                (assets.length ? assets.map(function (asset) {
                  var offer = getOffer(asset.id);
                  return (
                    '<div class="trade-asset-row' + (offer ? ' trade-asset-row--selected' : '') + '" data-draggable-asset="' + ESCAPE(asset.id) + '" draggable="true">' +
                      '<div class="trade-asset-main">' +
                        '<div>' +
                          '<div class="trade-asset-title">' +
                            (asset.type === "player" ? '<a href="' + ESCAPE(getPlayerLink(asset.player)) + '" target="data" draggable="false">' + ESCAPE(asset.name) + '</a>' : ESCAPE(asset.name)) +
                          '</div>' +
                          '<div class="trade-asset-meta">' + ESCAPE(asset.subtitle) + '</div>' +
                        '</div>' +
                        '<div class="trade-inline-actions">' +
                          '<span class="trade-drag-handle" data-drag-handle="' + ESCAPE(asset.id) + '" draggable="false" title="Drag this card to another team">::</span>' +
                          (asset.type === "rights" ? '<span class="trade-tag trade-tag--rights">Rights</span>' : '<span class="trade-money">' + ESCAPE(asset.amountText) + '</span>') +
                          '<button class="trade-mini-btn' + (offer ? ' trade-mini-btn--remove' : '') + '" type="button" data-toggle-asset="' + ESCAPE(asset.id) + '">' + (offer ? 'Remove' : 'Add') + '</button>' +
                        '</div>' +
                      '</div>' +
                    '</div>'
                  );
                }).join("") : '<div class="trade-empty">No matching assets for this team.</div>') +
              '</div>'
            ) : '<div class="trade-empty">Pick a team before building outgoing assets.</div>') +
          '</section>' +
          '<section class="trade-card-section">' +
            '<p class="trade-card-label">Outgoing Package</p>' +
            '<div class="trade-outgoing-list">' +
              (outgoingRows.length ? outgoingRows.map(function (assetId) {
                return renderOutgoingRow(assetId, teamId, evaluation.participants);
              }).join("") : '<div class="trade-empty">No outgoing assets selected.</div>') +
            '</div>' +
          '</section>' +
          '<section class="trade-card-section">' +
            '<p class="trade-card-label">Incoming Preview</p>' +
            '<div class="trade-incoming-list">' +
              (incomingRows.length ? incomingRows.map(function (assetId) {
                return renderIncomingRow(assetId);
              }).join("") : '<div class="trade-empty">No incoming assets yet.</div>') +
            '</div>' +
          '</section>' +
          '<section class="trade-card-section">' +
            '<p class="trade-card-label">Optional Post-Trade Cuts</p>' +
            '<div class="trade-cut-list">' +
              (summary ? (cutPlayers.length ? cutPlayers.map(function (player) {
                return renderCutRow(teamId, player);
              }).join("") : '<div class="trade-empty">No eligible post-trade cuts. Only players below ' + ESCAPE(formatMoney(CUT_SALARY_LIMIT)) + ' can be cut here.</div>') : '<div class="trade-empty">Choose a team first.</div>') +
            '</div>' +
          '</section>' +
        '</article>'
      );
    }).join("");

    bindTeamCardEvents();
  }

  function renderHeaderStat(label, value, note) {
    return (
      '<div class="trade-header-stat">' +
        '<span class="trade-header-stat__label">' + ESCAPE(label) + '</span>' +
        '<span class="trade-header-stat__value">' + ESCAPE(value) + '</span>' +
        '<span class="trade-header-stat__note">' + ESCAPE(note || "") + '</span>' +
      '</div>'
    );
  }

  function renderOutgoingRow(assetId, teamId, participants) {
    var offer = state.offers[assetId] || {};
    var type = assetKind(assetId);
    var isRights = type === "rights";
    var asset = isRights ? state.rightsById[assetId] : state.playerById[assetId];
    var options = ['<option value="">Choose destination</option>'].concat(participants.filter(function (candidateId) {
      return candidateId !== teamId;
    }).map(function (candidateId) {
      return '<option value="' + ESCAPE(candidateId) + '"' + (offer.toTeamId === candidateId ? " selected" : "") + ">" + ESCAPE(state.teamById[candidateId].name) + "</option>";
    })).join("");

    return (
      '<div class="trade-flow-row" data-draggable-asset="' + ESCAPE(assetId) + '" draggable="true">' +
        '<div class="trade-flow-main">' +
          '<div>' +
            '<div class="trade-flow-title">' + ESCAPE(isRights ? "RIGHTS TO " + asset.name : asset.name) + '</div>' +
            '<div class="trade-flow-meta">' + ESCAPE(isRights ? [asset.pos, asset.age ? "Age " + asset.age : ""].filter(Boolean).join(" | ") : [asset.pos, asset.currentSalaryText].filter(Boolean).join(" | ")) + '</div>' +
          '</div>' +
          '<div class="trade-inline-actions">' +
              '<span class="trade-drag-handle" data-drag-handle="' + ESCAPE(assetId) + '" draggable="false" title="Drag this card to another team">::</span>' +
            '<button class="trade-mini-btn trade-mini-btn--remove" type="button" data-toggle-asset="' + ESCAPE(assetId) + '">Remove</button>' +
          '</div>' +
        '</div>' +
        '<div class="trade-flow-fields">' +
          '<div class="trade-field">' +
            '<label class="trade-field-label">Send To</label>' +
            '<select class="trade-select" data-destination-select="' + ESCAPE(assetId) + '">' + options + '</select>' +
          '</div>' +
          '<div class="trade-field">' +
            '<label class="trade-field-label">Asset Type</label>' +
            '<div class="trade-tag' + (isRights ? ' trade-tag--rights' : '') + '">' + ESCAPE(isRights ? "Rights" : "Player") + '</div>' +
          '</div>' +
        '</div>' +
        (isRights ? "" : (
          '<div class="trade-checkboxes">' +
            '<label class="trade-checkbox">' +
              '<input type="checkbox" data-recent-tradeback="' + ESCAPE(assetId) + '"' + (offer.recentTradeback ? " checked" : "") + '>' +
              '<span>Acquired from the selected destination team within the last 24 hours (trade back is blocked).</span>' +
            '</label>' +
          '</div>'
        )) +
        '</div>'
    );
  }

  function renderIncomingRow(assetId) {
    var offer = state.offers[assetId];
    var type = assetKind(assetId);
    var isRights = type === "rights";
    var asset = isRights ? state.rightsById[assetId] : state.playerById[assetId];
    var fromTeamId = getAssetOwnerTeamId(assetId);
    var fromTeamName = fromTeamId && state.teamById[fromTeamId] ? state.teamById[fromTeamId].name : "Unknown team";

    return (
      '<div class="trade-flow-row">' +
        '<div class="trade-flow-main">' +
          '<div>' +
            '<div class="trade-flow-title">' + ESCAPE(isRights ? "RIGHTS TO " + asset.name : asset.name) + '</div>' +
            '<div class="trade-flow-meta">From ' + ESCAPE(fromTeamName) + (isRights ? "" : " | " + ESCAPE(asset.currentSalaryText)) + '</div>' +
          '</div>' +
          '<span class="trade-tag' + (isRights ? ' trade-tag--rights' : '') + '">' + ESCAPE(isRights ? "Rights" : "Player") + '</span>' +
        '</div>' +
      '</div>'
    );
  }

  function renderCutRow(teamId, player) {
    var teamCuts = state.cuts[teamId] || {};
    var cutFlags = teamCuts[player.id] || null;
    return (
      '<div class="trade-cut-row">' +
        '<div class="trade-cut-main">' +
          '<div>' +
            '<div class="trade-cut-title">' + ESCAPE(player.name) + '</div>' +
            '<div class="trade-cut-meta">' + ESCAPE([player.pos, player.currentSalaryText].filter(Boolean).join(" | ")) + '</div>' +
          '</div>' +
          '<button class="trade-mini-btn' + (cutFlags ? ' trade-mini-btn--remove' : '') + '" type="button" data-toggle-cut="' + ESCAPE(teamId) + '" data-cut-player="' + ESCAPE(player.id) + '">' + (cutFlags ? 'Undo Cut' : 'Cut') + '</button>' +
        '</div>' +
        (cutFlags ? (
          '<div class="trade-checkboxes">' +
            '<label class="trade-checkbox">' +
              '<input type="checkbox" data-cut-flag="' + ESCAPE(teamId) + '" data-cut-player="' + ESCAPE(player.id) + '" data-flag-name="cutToFacilitate"' + (cutFlags.cutToFacilitate ? " checked" : "") + '>' +
              '<span>Cut to facilitate the deal. Same team cannot re-sign this player within 24 hours.</span>' +
            '</label>' +
            '<label class="trade-checkbox">' +
              '<input type="checkbox" data-cut-flag="' + ESCAPE(teamId) + '" data-cut-player="' + ESCAPE(player.id) + '" data-flag-name="tradedThenCutReturn"' + (cutFlags.tradedThenCutReturn ? " checked" : "") + '>' +
              '<span>If cut after the trade, this player cannot return to his original team until the next sim.</span>' +
            '</label>' +
          '</div>'
        ) : "") +
        '</div>'
    );
  }

  function bindTeamCardEvents() {
    document.querySelectorAll("[data-draggable-asset]").forEach(function (dragSource) {
      dragSource.addEventListener("dragstart", function (event) {
        var assetId = dragSource.getAttribute("data-draggable-asset");
        if (!assetId) {
          return;
        }
        state.draggingAssetId = assetId;
        if (event.dataTransfer) {
          event.dataTransfer.setData("text/plain", assetId);
          event.dataTransfer.effectAllowed = "move";
        }
        dragSource.classList.add("trade-dragging");
      });

      dragSource.addEventListener("dragend", function () {
        state.draggingAssetId = "";
        dragSource.classList.remove("trade-dragging");
      });
    });

    document.querySelectorAll("[data-drop-team]").forEach(function (card) {
      card.addEventListener("dragover", function (event) {
        var assetId = state.draggingAssetId || (event.dataTransfer ? event.dataTransfer.getData("text/plain") : "");
        var targetTeamId = card.getAttribute("data-drop-team") || "";

        if (!assetId || !targetTeamId || getAssetOwnerTeamId(assetId) === targetTeamId) {
          return;
        }

        event.preventDefault();
        if (event.dataTransfer) {
          event.dataTransfer.dropEffect = "move";
        }
        card.classList.add("trade-team-card--drop-target");
      });

      card.addEventListener("dragleave", function (event) {
        if (!card.contains(event.relatedTarget)) {
          card.classList.remove("trade-team-card--drop-target");
        }
      });

      card.addEventListener("drop", function (event) {
        var assetId = state.draggingAssetId || (event.dataTransfer ? event.dataTransfer.getData("text/plain") : "");
        var targetTeamId = card.getAttribute("data-drop-team") || "";

        card.classList.remove("trade-team-card--drop-target");

        if (!assetId || !targetTeamId) {
          return;
        }

        event.preventDefault();
        if (assignDraggedAssetToTeam(assetId, targetTeamId)) {
          state.draggingAssetId = "";
          saveSession();
          rerender();
        }
      });

      card.addEventListener("dragend", function () {
        card.classList.remove("trade-team-card--drop-target");
      });
    });

    document.addEventListener("dragend", function () {
      state.draggingAssetId = "";
      document.querySelectorAll(".trade-team-card--drop-target").forEach(function (card) {
        card.classList.remove("trade-team-card--drop-target");
      });
    });

    document.querySelectorAll("[data-team-select]").forEach(function (select) {
      select.addEventListener("change", function () {
        var slotIndex = Number(select.getAttribute("data-team-select"));
        var previousTeamId = state.slots[slotIndex] || "";
        var nextTeamId = select.value || "";

        if (previousTeamId && previousTeamId !== nextTeamId) {
          removeTeamFromTradeState(previousTeamId);
        }

        state.slots[slotIndex] = nextTeamId;
        saveSession();
        rerender();
      });
    });

    document.querySelectorAll("[data-remove-slot]").forEach(function (button) {
      button.addEventListener("click", function () {
        var index = Number(button.getAttribute("data-remove-slot"));
        var removedTeamId = state.slots[index] || "";

        removeTeamFromTradeState(removedTeamId);
        state.slots.splice(index, 1);
        if (state.slots.length < MIN_TEAMS) {
          state.slots.push("");
        }
        saveSession();
        rerender();
      });
    });

    document.querySelectorAll("[data-team-search]").forEach(function (input) {
      input.addEventListener("input", function () {
        state.searches[input.getAttribute("data-team-search")] = input.value || "";
        saveSession();
        rerender();
      });
    });

    document.querySelectorAll("[data-clear-search]").forEach(function (button) {
      button.addEventListener("click", function () {
        state.searches[button.getAttribute("data-clear-search")] = "";
        saveSession();
        rerender();
      });
    });

    document.querySelectorAll("[data-toggle-asset]").forEach(function (button) {
      button.addEventListener("click", function () {
        var assetId = button.getAttribute("data-toggle-asset");
        if (state.offers[assetId]) {
          delete state.offers[assetId];
        } else {
          state.offers[assetId] = {
            toTeamId: getAutoDestinationTeamId(assetId),
            recentTradeback: false
          };
        }
        saveSession();
        rerender();
      });
    });

    document.querySelectorAll("[data-destination-select]").forEach(function (select) {
      select.addEventListener("change", function () {
        var assetId = select.getAttribute("data-destination-select");
        state.offers[assetId] = state.offers[assetId] || {};
        state.offers[assetId].toTeamId = select.value || "";
        saveSession();
        rerender();
      });
    });

    document.querySelectorAll("[data-recent-tradeback]").forEach(function (checkbox) {
      checkbox.addEventListener("change", function () {
        var assetId = checkbox.getAttribute("data-recent-tradeback");
        state.offers[assetId] = state.offers[assetId] || {};
        state.offers[assetId].recentTradeback = !!checkbox.checked;
        saveSession();
        rerender();
      });
    });

    document.querySelectorAll("[data-toggle-cut]").forEach(function (button) {
      button.addEventListener("click", function () {
        var teamId = button.getAttribute("data-toggle-cut");
        var playerId = button.getAttribute("data-cut-player");
        state.cuts[teamId] = state.cuts[teamId] || {};
        if (state.cuts[teamId][playerId]) {
          delete state.cuts[teamId][playerId];
        } else {
          state.cuts[teamId][playerId] = { cutToFacilitate: false, tradedThenCutReturn: false };
        }
        saveSession();
        rerender();
      });
    });

    document.querySelectorAll("[data-cut-flag]").forEach(function (checkbox) {
      checkbox.addEventListener("change", function () {
        var teamId = checkbox.getAttribute("data-cut-flag");
        var playerId = checkbox.getAttribute("data-cut-player");
        var flagName = checkbox.getAttribute("data-flag-name");
        state.cuts[teamId] = state.cuts[teamId] || {};
        state.cuts[teamId][playerId] = state.cuts[teamId][playerId] || { cutToFacilitate: false, tradedThenCutReturn: false };
        state.cuts[teamId][playerId][flagName] = !!checkbox.checked;
        saveSession();
        rerender();
      });
    });
  }

  function applyPlayerOverride() {
    var input = document.getElementById("tradePlayerOverrideInput");
    var teamSelect = document.getElementById("tradePlayerOverrideTeam");
    var playerId = (input.getAttribute("data-selected-id") || "").trim();
    var teamId = teamSelect.value || "";

    if (!playerId || !state.playerById[playerId]) {
      window.alert("Choose a player from the current player list first.");
      return;
    }

    state.overrides.players[playerId] = teamId;
    input.value = "";
    input.removeAttribute("data-selected-id");
    saveSession();
    rerender();
  }

  function applyRightsOverride() {
    var input = document.getElementById("tradeRightsOverrideInput");
    var teamSelect = document.getElementById("tradeRightsOverrideTeam");
    var rightsId = (input.getAttribute("data-selected-id") || "").trim();
    var teamId = teamSelect.value || "";

    if (!rightsId || !state.rightsById[rightsId]) {
      window.alert("Choose a youth rights asset from the current rights list first.");
      return;
    }

    state.overrides.rights[rightsId] = teamId;
    input.value = "";
    input.removeAttribute("data-selected-id");
    saveSession();
    rerender();
  }

  function removePlayerFromLocalRosters() {
    var input = document.getElementById("tradePlayerOverrideInput");
    var playerId = (input.getAttribute("data-selected-id") || "").trim();

    if (!playerId || !state.playerById[playerId]) {
      window.alert("Choose a player from the current player list first.");
      return;
    }

    state.overrides.players[playerId] = "";
    input.value = "";
    input.removeAttribute("data-selected-id");
    saveSession();
    rerender();
  }

  function removeRightsOwner() {
    var input = document.getElementById("tradeRightsOverrideInput");
    var rightsId = (input.getAttribute("data-selected-id") || "").trim();

    if (!rightsId || !state.rightsById[rightsId]) {
      window.alert("Choose a youth rights asset from the current rights list first.");
      return;
    }

    state.overrides.rights[rightsId] = "";
    input.value = "";
    input.removeAttribute("data-selected-id");
    saveSession();
    rerender();
  }

  function buildOverrideLookupInputs() {
    var playerInput = document.getElementById("tradePlayerOverrideInput");
    var rightsInput = document.getElementById("tradeRightsOverrideInput");
    var playerList = document.getElementById("tradeAllPlayersList");
    var rightsList = document.getElementById("tradeAllRightsList");
    var playerLookup = {};
    var rightsLookup = {};

    playerList.innerHTML = state.players.map(function (player) {
      var ownerId = getEffectivePlayerTeamId(player.id);
      var ownerLabel = ownerId && state.teamById[ownerId] ? state.teamById[ownerId].name : "Unassigned";
      var display = player.name + " | " + ownerLabel + (player.pos ? " | " + player.pos : "");
      playerLookup[display] = player.id;
      return '<option value="' + ESCAPE(display) + '"></option>';
    }).join("");

    rightsList.innerHTML = state.rights.map(function (asset) {
      var ownerId = getEffectiveRightsTeamId(asset.id);
      var ownerLabel = ownerId && state.teamById[ownerId] ? state.teamById[ownerId].name : "Unassigned";
      var display = asset.name + " | Rights | " + ownerLabel;
      rightsLookup[display] = asset.id;
      return '<option value="' + ESCAPE(display) + '"></option>';
    }).join("");

    function syncLookup(input, map) {
      function updateSelection() {
        var id = map[input.value] || "";
        if (id) {
          input.setAttribute("data-selected-id", id);
        } else {
          input.removeAttribute("data-selected-id");
        }
      }

      input.addEventListener("input", updateSelection);
      input.addEventListener("change", updateSelection);
    }

    syncLookup(playerInput, playerLookup);
    syncLookup(rightsInput, rightsLookup);
  }

  function populateOverrideTeamSelects() {
    var options = ['<option value="">Unassigned</option>'].concat(state.teams.map(function (team) {
      return '<option value="' + ESCAPE(team.id) + '">' + ESCAPE(team.name) + "</option>";
    })).join("");

    document.getElementById("tradePlayerOverrideTeam").innerHTML = options;
    document.getElementById("tradeRightsOverrideTeam").innerHTML = options;
  }

  function setPlayerOverrideTeam(playerId, targetTeamId) {
    var officialTeamId = (state.playerById[playerId] && state.playerById[playerId].teamId) || "";
    if ((targetTeamId || "") === officialTeamId) {
      delete state.overrides.players[playerId];
      return;
    }
    state.overrides.players[playerId] = targetTeamId || "";
  }

  function setRightsOverrideTeam(rightsId, targetTeamId) {
    var officialTeamId = (state.rightsById[rightsId] && state.rightsById[rightsId].teamId) || "";
    if ((targetTeamId || "") === officialTeamId) {
      delete state.overrides.rights[rightsId];
      return;
    }
    state.overrides.rights[rightsId] = targetTeamId || "";
  }

  function applyCurrentTradeToOverrides() {
    var assetIds = Object.keys(state.offers || {}).filter(function (assetId) {
      var offer = state.offers[assetId];
      return !!(offer && offer.toTeamId);
    });

    if (!assetIds.length) {
      window.alert("Add at least one asset to the trade before pushing it into local overrides.");
      return;
    }

    assetIds.forEach(function (assetId) {
      var offer = state.offers[assetId];
      if (!offer || !offer.toTeamId) {
        return;
      }

      if (assetKind(assetId) === "rights") {
        setRightsOverrideTeam(assetId, offer.toTeamId);
        return;
      }

      if (state.playerById[assetId]) {
        setPlayerOverrideTeam(assetId, offer.toTeamId);
      }
    });

    Object.keys(state.cuts || {}).forEach(function (teamId) {
      var teamCuts = state.cuts[teamId] || {};
      Object.keys(teamCuts).forEach(function (playerId) {
        if (teamCuts[playerId]) {
          setPlayerOverrideTeam(playerId, "");
        }
      });
    });

    state.offers = {};
    state.cuts = {};
    saveSession();
    rerender();
  }

  function copySummary() {
    var text = document.getElementById("tradeSummaryOutput").value || "";
    if (!text) {
      window.alert("There is no trade summary to copy yet.");
      return;
    }

    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () {
        window.alert("Trade summary copied.");
      }).catch(function () {
        fallbackCopy(text);
      });
      return;
    }

    fallbackCopy(text);
  }

  function fallbackCopy(text) {
    var area = document.getElementById("tradeSummaryOutput");
    area.focus();
    area.select();
    try {
      document.execCommand("copy");
      window.alert("Trade summary copied.");
    } catch (error) {
      window.alert("Copy failed. The summary is still highlighted for manual copy.");
    }
  }

  function rerender() {
    clearInvalidState();
    var evaluation = evaluateTrade();
    renderVerdict(evaluation);
    renderTeamCards(evaluation);
    renderOverrides();
    saveSession();
  }

  function bindGlobalEvents() {
      document.getElementById("tradeAddTeamBtn").addEventListener("click", function () {
        if (state.slots.length >= MAX_TEAMS) {
          return;
        }
        state.slots.push("");
        saveSession();
        rerender();
      });

      document.getElementById("tradeApplyTradeToOverridesBtn").addEventListener("click", applyCurrentTradeToOverrides);
      document.getElementById("tradeClearBtn").addEventListener("click", function () {
        state.offers = {};
        state.cuts = {};
        saveSession();
        rerender();
    });

    document.getElementById("tradeResetOverridesBtn").addEventListener("click", function () {
      state.overrides = { players: {}, rights: {} };
      saveSession();
      rerender();
    });

    document.getElementById("tradeCopyBtn").addEventListener("click", copySummary);
    document.getElementById("tradeApplyPlayerOverrideBtn").addEventListener("click", applyPlayerOverride);
    document.getElementById("tradeRemovePlayerOverrideBtn").addEventListener("click", removePlayerFromLocalRosters);
    document.getElementById("tradeApplyRightsOverrideBtn").addEventListener("click", applyRightsOverride);
    document.getElementById("tradeRemoveRightsOverrideBtn").addEventListener("click", removeRightsOwner);
  }

  function initialize() {
    Promise.all([
      loadJson(PLAYERS_PATH),
      loadJson(TEAMS_PATH),
      loadJson(CAPREPORT_PATH),
      loadJson(STANDINGS_PATH)
    ]).then(function (results) {
      buildBaseData(results);
      restoreSession();
      return loadTeamColors().then(function () {
        buildOverrideLookupInputs();
        populateOverrideTeamSelects();
        bindGlobalEvents();
        state.loaded = true;
        rerender();
      });
    }).catch(function (error) {
      document.getElementById("tradeGrid").innerHTML = '<div class="trade-empty">Unable to load trade-tool data: ' + ESCAPE(error && error.message ? error.message : "Unknown error") + "</div>";
      document.getElementById("tradeVerdictPill").textContent = "Load Failed";
      document.getElementById("tradeVerdictPill").className = "trade-pill trade-pill--bad";
      document.getElementById("tradeVerdictText").textContent = "One or more required JSON files could not be loaded for the trade tool.";
    });
  }

  document.addEventListener("DOMContentLoaded", initialize);
})();
