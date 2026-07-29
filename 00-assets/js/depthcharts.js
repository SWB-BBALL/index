(function () {
  "use strict";

  var ROLES = ["C", "PF", "SF", "SG", "PG", "6th", "7th", "8th", "9th", "10th", "11th", "12th", "13th"];
  var TEAM_SELECT_ID = "team-select";
  var PLAYERS_PATH = "../../00-build/database/players.json";
  var TEAMS_PATH = "../../00-build/database/teams.json";
  var INJURIES_PATH = "../../00-build/database/injuries.json";
  var STORAGE_PREFIX = "bsl-depth-chart:";
  var LAST_TEAM_KEY = STORAGE_PREFIX + "last-team";
  var TEAM_COLOR_FALLBACK = "#1e293b";
  var teamColorCache = {};

  var state = {
    teams: [],
    players: [],
    injuries: [],
    roster: [],
    isRestoring: false
  };

  function clean(value) {
    return String(value == null ? "" : value).replace(/\s+/g, " ").trim();
  }

  function numberValue(value) {
    var parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function loadJson(path) {
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
            reject(new Error("No JSON data found at " + path));
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
          var frameDocument = frame.contentDocument || frame.contentWindow.document;
          var raw = frameDocument && frameDocument.documentElement ? frameDocument.documentElement.innerHTML : "";

          frame.remove();

          if (!raw) {
            reject(new Error("No HTML data found at " + path));
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

  function rgbToHex(rgb) {
    return "#" + [rgb.r, rgb.g, rgb.b].map(function (value) {
      return Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, "0");
    }).join("").toUpperCase();
  }

  function mixColor(hex, targetHex, amount) {
    var color = hexToRgb(hex);
    var target = hexToRgb(targetHex);

    return rgbToHex({
      r: color.r + (target.r - color.r) * amount,
      g: color.g + (target.g - color.g) * amount,
      b: color.b + (target.b - color.b) * amount
    });
  }

  function getContrastText(hex) {
    var color = hexToRgb(hex);
    var brightness = (color.r * 299 + color.g * 587 + color.b * 114) / 1000;

    return brightness > 150 ? "#0f172a" : "#f8fafc";
  }

  function getTeamRosterPath(team) {
    return team && team.file ? "../../rosters/" + team.file : "";
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

  function applyTeamColor(color) {
    var primary = normalizeHexColor(color) || TEAM_COLOR_FALLBACK;

    document.body.style.setProperty("--depth-team-color", primary);
  }

  function updateTeamColor(team) {
    var path = getTeamRosterPath(team);

    if (!team || !path) {
      applyTeamColor(TEAM_COLOR_FALLBACK);
      return;
    }

    if (teamColorCache[team.id]) {
      applyTeamColor(teamColorCache[team.id]);
      return;
    }

    loadText(path).then(function (html) {
      var color = extractTeamColor(html) || TEAM_COLOR_FALLBACK;
      teamColorCache[team.id] = color;

      if (team.id === getSelectedTeamId()) {
        applyTeamColor(color);
      }
    }).catch(function () {
      applyTeamColor(TEAM_COLOR_FALLBACK);
    });
  }

  function option(value, label, selected) {
    return '<option value="' + escapeHtml(value) + '"' + (selected ? " selected" : "") + ">" + escapeHtml(label) + "</option>";
  }

  function getPlayerKey(player) {
    return player && player.url ? player.url : "";
  }

  function getPlayerByKey(key) {
    return state.roster.find(function (player) {
      return getPlayerKey(player) === key;
    }) || null;
  }

  function normalizeName(value) {
    return clean(value).toLowerCase();
  }

  function getPlayerByName(name) {
    var normalizedName = normalizeName(name);
    return state.roster.find(function (player) {
      return normalizeName(player.name) === normalizedName;
    }) || null;
  }

  function isPlayerInjured(player) {
    if (!player) {
      return false;
    }

    return state.injuries.some(function (injury) {
      return normalizeName(injury.name) === normalizeName(player.name) &&
        (!injury.team || !player.teamName || normalizeName(injury.team) === normalizeName(player.teamName));
    });
  }

  function updateRowInjuryState(row, player) {
    if (!row) {
      return;
    }

    row.classList.toggle("depth-row--injured", isPlayerInjured(player));
  }

  function isStarterRole(role) {
    return ["C", "PF", "SF", "SG", "PG"].indexOf(role) !== -1;
  }

  function getManualPositionForRow(row, player) {
    var role = row.getAttribute("data-role");

    if (player && isStarterRole(role)) {
      return role;
    }

    return player ? player.pos : "Position(s)";
  }

  function getSelectedTeamId() {
    return document.getElementById(TEAM_SELECT_ID).value || "";
  }

  function getStorageKey(teamId) {
    return STORAGE_PREFIX + teamId;
  }

  function safeSetStorage(key, value) {
    try {
      window.localStorage.setItem(key, value);
    } catch (error) {
      document.getElementById("copy-status").textContent = "Storage blocked";
    }
  }

  function safeGetStorage(key) {
    try {
      return window.localStorage.getItem(key);
    } catch (error) {
      return null;
    }
  }

  function getSelectedPlayerKeys() {
    return Array.prototype.map.call(document.querySelectorAll(".depth-player-select"), function (select) {
      return select.value;
    }).filter(Boolean);
  }

  function getSelectedPlayers() {
    return getSelectedPlayerKeys().map(getPlayerByKey).filter(Boolean);
  }

  function buildPlayerOptions(selectedKey) {
    var selectedKeys = getSelectedPlayerKeys();
    var options = [option("", "Open slot", !selectedKey)];

    state.roster.forEach(function (player) {
      var key = getPlayerKey(player);
      var isTaken = selectedKeys.indexOf(key) !== -1 && key !== selectedKey;
      var label = player.name + " - " + player.pos +
        ((!window.LeagueSiteCore || LeagueSiteCore.showRatingNumbers()) ? " - OVR " + (player.overall || "-") : "");

      options.push(
        '<option value="' + escapeHtml(key) + '"' +
        (selectedKey === key ? " selected" : "") +
        (isTaken ? " disabled" : "") +
        ">" + escapeHtml(label) + "</option>"
      );
    });

    return options.join("");
  }

  function renderTeamSelect(selectedTeamId) {
    var select = document.getElementById(TEAM_SELECT_ID);
    select.innerHTML = state.teams.map(function (team, index) {
      return option(team.id, team.name, selectedTeamId ? team.id === selectedTeamId : index === 0);
    }).join("");
  }

  function renderDepthSlots() {
    var body = document.getElementById("depth-slots");

    body.innerHTML = ROLES.map(function (role) {
      return [
        '<tr data-role="' + escapeHtml(role) + '">',
        '<td class="depth-role" draggable="true" title="Drag to swap this slot">' + escapeHtml(role) + "</td>",
        '<td><select class="depth-select depth-player-select"></select></td>',
        '<td><input class="depth-input depth-position-input" type="text" value="Position(s)"></td>',
        '<td><input class="depth-input depth-minutes" type="number" min="0" max="48" value=""></td>',
        '<td class="depth-change"><input class="depth-bold-input" type="checkbox" title="Wrap this copied line in bold markers"></td>',
        "</tr>"
      ].join("");
    }).join("");

    Array.prototype.forEach.call(document.querySelectorAll(".depth-player-select"), function (select) {
      select.innerHTML = buildPlayerOptions("");
      select.addEventListener("change", function () {
        var row = select.closest("tr");
        var player = getPlayerByKey(select.value);
        row.querySelector(".depth-position-input").value = getManualPositionForRow(row, player);
        updateRowInjuryState(row, player);
        if (!player) {
          row.querySelector(".depth-minutes").value = "";
        }
        refreshPlayerOptions();
        refreshFocusOptions();
        updateOutput();
      });
    });

    Array.prototype.forEach.call(document.querySelectorAll(".depth-position-input, .depth-minutes, .depth-bold-input"), function (input) {
      input.addEventListener("input", updateOutput);
      input.addEventListener("change", updateOutput);
    });

    bindDepthRowDrag();
  }

  function getRowFormState(row) {
    return {
      playerKey: row.querySelector(".depth-player-select").value,
      positions: row.querySelector(".depth-position-input").value,
      minutes: row.querySelector(".depth-minutes").value,
      bold: row.querySelector(".depth-bold-input").checked
    };
  }

  function applyRowFormState(row, rowState) {
    var player = getPlayerByKey(rowState.playerKey);

    row.querySelector(".depth-player-select").value = player ? rowState.playerKey : "";
    row.querySelector(".depth-position-input").value = rowState.positions || (player ? player.pos : "Position(s)");
    row.querySelector(".depth-minutes").value = rowState.minutes || "";
    row.querySelector(".depth-bold-input").checked = !!rowState.bold;
    updateRowInjuryState(row, player);
  }

  function clearDragState() {
    Array.prototype.forEach.call(document.querySelectorAll("#depth-slots tr"), function (row) {
      row.classList.remove("depth-row--dragging", "depth-row--drop-target");
    });
  }

  function swapDepthRows(sourceRow, targetRow) {
    var sourceState = getRowFormState(sourceRow);
    var targetState = getRowFormState(targetRow);

    applyRowFormState(sourceRow, targetState);
    applyRowFormState(targetRow, sourceState);
    updateDroppedStarterPosition(sourceRow);
    updateDroppedStarterPosition(targetRow);
    refreshPlayerOptions();
    refreshFocusOptions();
    updateOutput();
  }

  function updateDroppedStarterPosition(row) {
    var player = getPlayerByKey(row.querySelector(".depth-player-select").value);

    if (!player) {
      return;
    }

    row.querySelector(".depth-position-input").value = isStarterRole(row.getAttribute("data-role"))
      ? row.getAttribute("data-role")
      : player.pos || "Position(s)";
  }

  function bindDepthRowDrag() {
    Array.prototype.forEach.call(document.querySelectorAll("#depth-slots tr"), function (row) {
      var handle = row.querySelector(".depth-role");

      if (!handle) {
        return;
      }

      handle.addEventListener("dragstart", function (event) {
        row.classList.add("depth-row--dragging");
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", row.getAttribute("data-role"));
      });

      handle.addEventListener("dragend", clearDragState);

      row.addEventListener("dragover", function (event) {
        event.preventDefault();
        if (!row.classList.contains("depth-row--dragging")) {
          row.classList.add("depth-row--drop-target");
        }
      });

      row.addEventListener("dragleave", function () {
        row.classList.remove("depth-row--drop-target");
      });

      row.addEventListener("drop", function (event) {
        var sourceRole = event.dataTransfer.getData("text/plain");
        var sourceRow = document.querySelector('#depth-slots tr[data-role="' + sourceRole + '"]');

        event.preventDefault();
        clearDragState();

        if (!sourceRow || sourceRow === row) {
          return;
        }

        swapDepthRows(sourceRow, row);
      });
    });
  }

  function refreshPlayerOptions() {
    Array.prototype.forEach.call(document.querySelectorAll(".depth-player-select"), function (select) {
      var selectedKey = select.value;
      select.innerHTML = buildPlayerOptions(selectedKey);
    });
  }

  function refreshFocusOptions() {
    var activePlayers = getSelectedPlayers();
    var focusSelects = document.querySelectorAll(".focus-player");

    Array.prototype.forEach.call(focusSelects, function (select) {
      var currentValue = select.value;
      select.innerHTML = option("", "None", !currentValue) + activePlayers.map(function (player) {
        return option(getPlayerKey(player), player.name, currentValue === getPlayerKey(player));
      }).join("");
    });
  }

  function setRoster(teamId) {
    var selectedTeam = state.teams.find(function (team) {
      return team.id === teamId;
    }) || null;

    updateTeamColor(selectedTeam);

    state.roster = state.players.filter(function (player) {
      return player.team === teamId;
    }).sort(function (a, b) {
      return numberValue(b.overall) - numberValue(a.overall) || a.name.localeCompare(b.name);
    });

    document.getElementById("roster-summary").textContent = state.roster.length + " players";
    renderDepthSlots();
    applyStoredState(loadTeamState(teamId));
    refreshFocusOptions();
    updateOutput();
  }

  function getRows() {
    return Array.prototype.map.call(document.querySelectorAll("#depth-slots tr"), function (row) {
      var select = row.querySelector(".depth-player-select");
      var player = getPlayerByKey(select.value);

      return {
        role: row.getAttribute("data-role"),
        player: player,
        positions: clean(row.querySelector(".depth-position-input").value),
        minutes: clean(row.querySelector(".depth-minutes").value),
        bold: row.querySelector(".depth-bold-input").checked
      };
    });
  }

  function getGameplanState() {
    var fields = {};
    Array.prototype.forEach.call(document.querySelectorAll(".depth-gameplan input, .depth-gameplan select"), function (input) {
      fields[input.id] = input.type === "checkbox" ? input.checked : input.value;
    });
    return fields;
  }

  function captureState() {
    return {
      rows: getRows().map(function (row) {
        return {
          role: row.role,
          playerKey: row.player ? getPlayerKey(row.player) : "",
          positions: row.positions,
          minutes: row.minutes,
          bold: row.bold
        };
      }),
      gameplan: getGameplanState()
    };
  }

  function saveCurrentTeamState() {
    var teamId = getSelectedTeamId();

    if (!teamId || state.isRestoring) {
      return;
    }

    safeSetStorage(getStorageKey(teamId), JSON.stringify(captureState()));
  }

  function loadTeamState(teamId) {
    var raw = safeGetStorage(getStorageKey(teamId));

    if (!raw) {
      return null;
    }

    try {
      return JSON.parse(raw);
    } catch (error) {
      return null;
    }
  }

  function applyStoredState(savedState) {
    if (!savedState) {
      return;
    }

    state.isRestoring = true;

    Array.prototype.forEach.call(document.querySelectorAll("#depth-slots tr"), function (row) {
      var role = row.getAttribute("data-role");
      var savedRow = (savedState.rows || []).find(function (item) {
        return item.role === role;
      });
      var player = savedRow ? getPlayerByKey(savedRow.playerKey) : null;

      if (!savedRow) {
        return;
      }

      row.querySelector(".depth-player-select").value = player ? savedRow.playerKey : "";
      row.querySelector(".depth-position-input").value = savedRow.positions || (player ? player.pos : "Position(s)");
      row.querySelector(".depth-minutes").value = savedRow.minutes || "";
      row.querySelector(".depth-bold-input").checked = !!savedRow.bold;
      updateRowInjuryState(row, player);
    });

    Object.keys(savedState.gameplan || {}).forEach(function (id) {
      var input = document.getElementById(id);
      if (input) {
        if (input.type === "checkbox") {
          input.checked = !!savedState.gameplan[id];
        } else {
          input.value = savedState.gameplan[id];
        }
      }
    });

    refreshPlayerOptions();
    refreshFocusOptions();

    Object.keys(savedState.gameplan || {}).forEach(function (id) {
      var input = document.getElementById(id);
      if (input && input.className.indexOf("focus-player") !== -1) {
        input.value = savedState.gameplan[id];
      }
    });

    state.isRestoring = false;
  }

  function setValueIfExists(id, value) {
    var input = document.getElementById(id);
    if (input && value !== "") {
      input.value = value;
    }
  }

  function getBoldInputForControl(id) {
    return document.querySelector('[data-gameplan-bold-for="' + id + '"]');
  }

  function isBoldLine(line) {
    return /^\*\*/.test(line) && /\*\*$/.test(line);
  }

  function setGameplanValue(id, value, bold) {
    setValueIfExists(id, value);

    var boldInput = getBoldInputForControl(id);
    if (boldInput) {
      boldInput.checked = !!bold;
    }
  }

  function parseDepthLine(line) {
    var normalizedLine = line.replace(/^\*\*/, "").replace(/\*\*$/, "");
    var match = normalizedLine.match(/^([^:]+):\s*(.*)$/);

    if (!match) {
      return null;
    }

    var role = clean(match[1]);
    if (ROLES.indexOf(role) === -1) {
      return null;
    }

    var parts = match[2].split("/");
    return {
      role: role,
      bold: /^\*\*/.test(line) && /\*\*$/.test(line),
      name: clean(parts[0]),
      positions: clean(parts[1] || ""),
      minutes: clean(parts[2] || "")
    };
  }

  function selectTeamFromTemplate(lines) {
    var titleLine = lines.find(function (line) {
      return /depth chart$/i.test(clean(line));
    });

    if (!titleLine) {
      return;
    }

    var teamName = clean(titleLine).replace(/\s+Depth Chart$/i, "");
    var team = state.teams.find(function (item) {
      return normalizeName(item.name) === normalizeName(teamName);
    });

    if (team && team.id !== getSelectedTeamId()) {
      document.getElementById(TEAM_SELECT_ID).value = team.id;
      safeSetStorage(LAST_TEAM_KEY, team.id);
      setRoster(team.id);
    }
  }

  function applyDepthChartTemplate(text) {
    var lines = String(text || "").split(/\r?\n/);
    var depthRows = lines.map(parseDepthLine).filter(Boolean);

    state.isRestoring = true;
    selectTeamFromTemplate(lines);
    state.isRestoring = true;

    Array.prototype.forEach.call(document.querySelectorAll("#depth-slots tr"), function (row) {
      var role = row.getAttribute("data-role");
      var parsedRow = depthRows.find(function (item) {
        return item.role === role;
      });
      var player = parsedRow ? getPlayerByName(parsedRow.name) : null;

      if (!parsedRow) {
        return;
      }

      row.querySelector(".depth-player-select").value = player ? getPlayerKey(player) : "";
      row.querySelector(".depth-position-input").value = parsedRow.positions || (player ? player.pos : "");
      row.querySelector(".depth-minutes").value = parsedRow.minutes || "";
      row.querySelector(".depth-bold-input").checked = parsedRow.bold;
      updateRowInjuryState(row, player);
    });

    lines.forEach(function (line) {
      var plainLine = line.replace(/^\*\*/, "").replace(/\*\*$/, "");
      var match = plainLine.match(/^([^:]+):\s*(.*)$/);
      if (!match) {
        return;
      }

      var key = clean(match[1]).toLowerCase();
      var value = clean(match[2]);

      if (key === "pace") setGameplanValue("pace-input", value, isBoldLine(line));
      if (key === "motion") setGameplanValue("motion-input", value, isBoldLine(line));
      if (key === "3pt usage") setGameplanValue("three-input", value, isBoldLine(line));
      if (key === "focus") setGameplanValue("focus-select", value, isBoldLine(line));
      if (key === "full court press") setGameplanValue("press-input", value, isBoldLine(line));
      if (key === "primary") setGameplanValue("primary-defense-select", value, isBoldLine(line));
      if (key === "secondary") setGameplanValue("secondary-defense-select", value, isBoldLine(line));
    });

    var usageLines = lines.filter(function (line) {
      return /^(\*\*)?Usage:/i.test(line);
    });
    if (usageLines[0]) setGameplanValue("primary-usage-input", clean(usageLines[0].replace(/^\*\*/, "").replace(/\*\*$/, "").split(":").slice(1).join(":")), isBoldLine(usageLines[0]));
    if (usageLines[1]) setGameplanValue("secondary-usage-input", clean(usageLines[1].replace(/^\*\*/, "").replace(/\*\*$/, "").split(":").slice(1).join(":")), isBoldLine(usageLines[1]));

    var crashLines = lines.filter(function (line) {
      return /^(\*\*)?Crash Boards:/i.test(line);
    });
    if (crashLines[0]) setGameplanValue("off-boards-input", clean(crashLines[0].replace(/^\*\*/, "").replace(/\*\*$/, "").split(":").slice(1).join(":")), isBoldLine(crashLines[0]));
    if (crashLines[1]) setGameplanValue("def-boards-input", clean(crashLines[1].replace(/^\*\*/, "").replace(/\*\*$/, "").split(":").slice(1).join(":")), isBoldLine(crashLines[1]));

    refreshPlayerOptions();
    refreshFocusOptions();

    var focusIndex = lines.findIndex(function (line) {
      return /^Focus Players:/i.test(line);
    });
    var focusNames = focusIndex === -1 ? [] : lines.slice(focusIndex + 1).map(function (line) {
      return clean(line.replace(/^\d+\.\s*/, ""));
    }).filter(function (line) {
      return line && line.toLowerCase() !== "none";
    }).slice(0, 3);

    Array.prototype.forEach.call(document.querySelectorAll(".focus-player"), function (select, index) {
      var player = getPlayerByName(focusNames[index] || "");
      select.value = player ? getPlayerKey(player) : "";
    });

    state.isRestoring = false;
    updateOutput();
  }

  function loadTemplateFromOutput() {
    var output = document.getElementById("depth-output");
    applyDepthChartTemplate(output.value);
    document.getElementById("copy-status").textContent = "Loaded";
  }

  function getIrPlayers() {
    var activeKeys = getSelectedPlayerKeys();
    return state.roster.filter(function (player) {
      return activeKeys.indexOf(getPlayerKey(player)) === -1;
    });
  }

  function setStatus(activeCount, totalMinutes) {
    var status = document.getElementById("depth-status");
    var pills = [];

    pills.push({ text: activeCount + " active", type: activeCount < 10 ? "bad" : activeCount > 13 ? "bad" : "" });
    pills.push({ text: totalMinutes + " minutes", type: totalMinutes === 240 ? "" : "warn" });
    pills.push({ text: getIrPlayers().length + " IR", type: "" });

    status.innerHTML = pills.map(function (pill) {
      return '<span class="depth-pill' + (pill.type ? " depth-pill--" + pill.type : "") + '">' + escapeHtml(pill.text) + "</span>";
    }).join("");
  }

  function formatDepthLine(row) {
    var line = row.role + ": ";

    if (!row.player) {
      return "";
    }

    line += row.player.name + "/" + (row.positions || row.player.pos || "-") + "/" + (row.minutes || "0");

    return row.bold ? "**" + line + "**" : line;
  }

  function getControlValue(id) {
    return clean(document.getElementById(id).value);
  }

  function formatGameplanLine(label, id) {
    var value = getControlValue(id);
    var line = label + ": " + value;
    var boldInput = getBoldInputForControl(id);

    return boldInput && boldInput.checked ? "**" + line + "**" : line;
  }

  function getFocusPlayerLines() {
    var names = Array.prototype.map.call(document.querySelectorAll(".focus-player"), function (select) {
      var player = getPlayerByKey(select.value);
      return player ? player.name : "";
    }).filter(Boolean);

    if (!names.length) {
      return ["None"];
    }

    return names.map(function (name, index) {
      return (index + 1) + ". " + name;
    });
  }

  function buildOutputText() {
    var team = state.teams.find(function (item) {
      return item.id === document.getElementById(TEAM_SELECT_ID).value;
    });
    var rows = getRows();
    var activeCount = rows.filter(function (row) { return row.player; }).length;
    var totalMinutes = rows.reduce(function (total, row) {
      return total + numberValue(row.minutes);
    }, 0);
    var irPlayers = getIrPlayers();
    var lines = [];

    setStatus(activeCount, totalMinutes);

    lines.push((team ? team.name : "Team") + " Depth Chart");
    lines.push("");

    rows.forEach(function (row) {
      var depthLine = formatDepthLine(row);
      if (depthLine) {
        lines.push(depthLine);
      }
    });

    lines.push("");
    lines.push("IR: " + (irPlayers.length ? irPlayers.map(function (player) { return player.name; }).join(", ") : "None"));
    lines.push("");
    lines.push("Gameplan:");
    lines.push("Offense:");
    lines.push(formatGameplanLine("Pace", "pace-input"));
    lines.push(formatGameplanLine("Motion", "motion-input"));
    lines.push(formatGameplanLine("3pt Usage", "three-input"));
    lines.push(formatGameplanLine("Focus", "focus-select"));
    lines.push(formatGameplanLine("Crash Boards", "off-boards-input"));
    lines.push("");
    lines.push("Defense:");
    lines.push(formatGameplanLine("Primary", "primary-defense-select"));
    lines.push(formatGameplanLine("Usage", "primary-usage-input"));
    lines.push(formatGameplanLine("Secondary", "secondary-defense-select"));
    lines.push(formatGameplanLine("Usage", "secondary-usage-input"));
    lines.push(formatGameplanLine("Full Court Press", "press-input"));
    lines.push(formatGameplanLine("Crash Boards", "def-boards-input"));
    lines.push("");
    lines.push("Focus Players:");
    Array.prototype.push.apply(lines, getFocusPlayerLines());

    return lines.join("\n");
  }

  function updateIrPreview() {
    var irPlayers = getIrPlayers();
    document.getElementById("ir-preview").textContent = irPlayers.length
      ? irPlayers.map(function (player) { return player.name + " (" + player.pos + ")"; }).join(", ")
      : "None";
  }

  function updateOutput() {
    updateIrPreview();
    document.getElementById("depth-output").value = buildOutputText();
    saveCurrentTeamState();
  }

  function autoFill() {
    var rows = document.querySelectorAll("#depth-slots tr");
    var rolePosition = {
      C: "C",
      PF: "PF",
      SF: "SF",
      SG: "SG",
      PG: "PG"
    };
    var used = {};

    Array.prototype.forEach.call(rows, function (row, index) {
      var role = row.getAttribute("data-role");
      var preferredPos = rolePosition[role];
      var available = state.roster.filter(function (player) {
        return !used[getPlayerKey(player)];
      });
      var player = available.find(function (candidate) {
        return preferredPos && String(candidate.pos || "").indexOf(preferredPos) !== -1;
      }) || available[0];

      if (player && index < 13) {
        used[getPlayerKey(player)] = true;
        row.querySelector(".depth-player-select").value = getPlayerKey(player);
        row.querySelector(".depth-position-input").value = player.pos || "";
        row.querySelector(".depth-minutes").value = index < 5 ? "32" : index < 10 ? "16" : "";
      }
    });

    refreshPlayerOptions();
    refreshFocusOptions();
    updateOutput();
  }

  function distributeMinutes() {
    var activeRows = Array.prototype.filter.call(document.querySelectorAll("#depth-slots tr"), function (row) {
      return !!row.querySelector(".depth-player-select").value;
    });
    var profile = [36, 36, 34, 34, 32, 25, 21, 17, 14, 11, 8, 6, 4];
    var totalWeight = activeRows.reduce(function (total, row, index) {
      var player = getPlayerByKey(row.querySelector(".depth-player-select").value);
      var overallBoost = numberValue(player && player.overall) / 25;

      return total + (profile[index] || 1) + overallBoost;
    }, 0);
    var assignments = [];
    var usedMinutes = 0;

    if (!activeRows.length || !totalWeight) {
      updateOutput();
      return;
    }

    activeRows.forEach(function (row, index) {
      var player = getPlayerByKey(row.querySelector(".depth-player-select").value);
      var weight = (profile[index] || 1) + numberValue(player && player.overall) / 25;
      var rawMinutes = weight / totalWeight * 240;
      var minutes = Math.floor(rawMinutes);

      assignments.push({
        row: row,
        minutes: minutes,
        remainder: rawMinutes - minutes
      });
      usedMinutes += minutes;
    });

    assignments.sort(function (a, b) {
      return b.remainder - a.remainder;
    });

    assignments.slice(0, 240 - usedMinutes).forEach(function (assignment) {
      assignment.minutes += 1;
    });

    assignments.forEach(function (assignment) {
      assignment.row.querySelector(".depth-minutes").value = String(assignment.minutes);
    });

    updateOutput();
  }

  function clearChart() {
    Array.prototype.forEach.call(document.querySelectorAll("#depth-slots tr"), function (row) {
      row.querySelector(".depth-player-select").value = "";
      row.querySelector(".depth-position-input").value = "Position(s)";
      row.querySelector(".depth-minutes").value = "";
      row.querySelector(".depth-bold-input").checked = false;
      updateRowInjuryState(row, null);
    });

    refreshPlayerOptions();
    refreshFocusOptions();
    updateOutput();
  }

  function copyOutput() {
    var output = document.getElementById("depth-output");
    var text = output.value;

    function copied() {
      document.getElementById("copy-status").textContent = "Copied";
      window.setTimeout(function () {
        document.getElementById("copy-status").textContent = "Ready";
      }, 1600);
    }

    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(copied).catch(function () {
        output.focus();
        output.select();
        document.execCommand("copy");
        copied();
      });
      return;
    }

    output.focus();
    output.select();
    document.execCommand("copy");
    copied();
  }

  function bindControls() {
    document.getElementById(TEAM_SELECT_ID).addEventListener("change", function (event) {
      safeSetStorage(LAST_TEAM_KEY, event.target.value);
      setRoster(event.target.value);
    });
    document.getElementById("auto-fill-button").addEventListener("click", autoFill);
    document.getElementById("distribute-minutes-button").addEventListener("click", distributeMinutes);
    document.getElementById("clear-button").addEventListener("click", clearChart);
    document.getElementById("refresh-output-button").addEventListener("click", updateOutput);
    document.getElementById("copy-button").addEventListener("click", copyOutput);
    document.getElementById("load-output-button").addEventListener("click", loadTemplateFromOutput);

    Array.prototype.forEach.call(document.querySelectorAll(".depth-gameplan input, .depth-gameplan select"), function (input) {
      input.addEventListener("input", updateOutput);
      input.addEventListener("change", updateOutput);
    });
  }

  function init() {
    Promise.all([
      loadJson(TEAMS_PATH),
      loadJson(PLAYERS_PATH),
      loadJson(INJURIES_PATH).catch(function () {
        return { injuries: [] };
      })
    ])
      .then(function (results) {
        state.teams = results[0].slice().sort(function (a, b) {
          return a.name.localeCompare(b.name);
        });
        state.players = results[1];
        state.injuries = Array.isArray(results[2].injuries) ? results[2].injuries : [];

        var lastTeamId = safeGetStorage(LAST_TEAM_KEY);
        var initialTeam = state.teams.find(function (team) {
          return team.id === lastTeamId;
        }) || state.teams[0];

        renderTeamSelect(initialTeam ? initialTeam.id : "");
        bindControls();
        setRoster(initialTeam ? initialTeam.id : "");
      })
      .catch(function (error) {
        document.getElementById("depth-status").innerHTML = '<span class="depth-pill depth-pill--bad">' + escapeHtml(error.message) + "</span>";
      });
  }

  document.addEventListener("DOMContentLoaded", init);
})();
