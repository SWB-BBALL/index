(function () {
  "use strict";

  var core = window.LeagueSiteCore;

  if (!core) {
    return;
  }

  function markStandingsPage() {
    if (core.shouldAttachStandingsSearch()) {
      document.body.classList.add("page-standings");
    }
  }

  function markClassicPage() {
    if (core.isMenuPage && core.isMenuPage()) {
      return;
    }

    if (core.isAssetHtmlPage && core.isAssetHtmlPage()) {
      return;
    }

    if (document.querySelector("td.header, td.main, td.teamheader, td.newheader")) {
      document.body.classList.add("page-classic");
    }
  }

  function markTransactionsPage() {
    var path = (window.location && window.location.pathname ? window.location.pathname : "").toLowerCase();
    var title = document.title ? document.title.trim().toLowerCase() : "";

    if (/\/transactions\.htm$/.test(path) || /\\transactions\.htm$/.test(path) || title === "transactions") {
      document.body.classList.add("page-transactions");
    }
  }

  function markSchedulePage() {
    var path = (window.location && window.location.pathname ? window.location.pathname : "").toLowerCase();
    var title = document.title ? document.title.trim().toLowerCase() : "";

    if (/\/schedule\.htm$/.test(path) || /\\schedule\.htm$/.test(path) || title === "league schedule") {
      document.body.classList.add("page-schedule");
    }
  }

  function getRosterPhotoPath(filename) {
    if (!filename) {
      return "";
    }

    return core.isNestedPage() ? "../00-assets/photos/" + filename : "00-assets/photos/" + filename;
  }

  function getRosterPhotoFilename(teamName) {
    var photoMap = {
      "Manchester United": "manutd.jpg",
      "Crystal Palace": "crystalpalace.jpg",
      "Bayern Munich": "bayern.jpg",
      "Real Madrid": "realmadrid.jpg",
      "AC Milan": "acmilan.jpg",
      "Brighton": "brighton.jpg",
      "Atletico Madrid": "atletico.jpg",
      "AFC Richmond": "richmond.jpg",
      "Benfica": "benfica.jpg",
      "Juventus": "juventus.jpg",
      "Marseille": "marseille.jpg",
      "Sheffield United": "sheffield.jpg",
      "Chelsea": "chelsea.jpg",
      "Ajax": "ajax.jpg",
      "Aston Villa": "astonvilla.jpg",
      "Monaco": "monaco.jpg",
      "Paris Saint-Germain": "psg.jpg",
      "Tottenham Hotspur": "tottenham.jpg",
      "Sporting CP": "sportingcp.jpg",
      "Barcelona": "barcelona.jpg",
      "Valencia": "valencia.jpg",
      "Inter Milan": "intermilan.jpg",
      "Manchester City": "manchestercity.jpg",
      "FL Fart": "flfart.jpg"
    };

    return photoMap[teamName] || "";
  }

  function applyRosterHeaderPhoto() {
    if (!core.isRosterPage()) {
      return;
    }

    var teamName = document.title ? document.title.trim() : "";
    var photoFilename = getRosterPhotoFilename(teamName);

    if (!photoFilename) {
      return;
    }

    var headerImage = document.querySelector("body > table img");

    if (!headerImage) {
      return;
    }

    headerImage.setAttribute("src", getRosterPhotoPath(photoFilename));
  }

  function cleanDivisionText(value) {
    return String(value || "")
      .replace(/\b(Champions League Basketball)\s+\1\s+Division:/i, "$1 Division:")
      .replace(/\b(Europa League Basketball)\s+\1\s+Division:/i, "$1 Division:")
      .replace(/\b(Conference League Basketball)\s+\1\s+Division:/i, "$1 Division:")
      .trim();
  }

  function enhanceClassicTeamHeader() {
    var banner = document.querySelector("body > table:first-of-type");
    var titleCell;
    var detailCells;
    var titleText;
    var titleMatch;
    var titleSpan;
    var recordSpan;

    if (!banner || !banner.querySelector("td.teamheader")) {
      return;
    }

    banner.classList.add("classic-team-banner");
    titleCell = banner.querySelector("td.teamheader");
    detailCells = Array.prototype.slice.call(banner.querySelectorAll("td.teamheader2"));
    titleText = titleCell.textContent.replace(/\s+/g, " ").trim();
    titleMatch = titleText.match(/^(.*?)\s+(\d+\s*-\s*\d+)$/);

    if (titleMatch) {
      titleCell.textContent = "";
      titleCell.classList.add("classic-team-banner__title-cell");

      titleSpan = document.createElement("span");
      titleSpan.className = "classic-team-banner__name";
      titleSpan.textContent = titleMatch[1].trim();

      recordSpan = document.createElement("span");
      recordSpan.className = "classic-team-banner__record";
      recordSpan.textContent = titleMatch[2].replace(/\s*-\s*/, "-");

      titleCell.appendChild(titleSpan);
      titleCell.appendChild(recordSpan);
    }

    detailCells.forEach(function (cell, index) {
      cell.classList.add(index === 0 ? "classic-team-banner__meta" : "classic-team-banner__location");
      cell.textContent = index === 0 ? cleanDivisionText(cell.textContent) : cell.textContent.replace(/\s+/g, " ").trim();
    });
  }

  function enhanceStandingsPlayoffCutoffs() {
    var tables;
    var appearance = ((core.config || {}).theme || {}).appearance || {};
    var places = Number(appearance.playoffPlaces == null ? 8 : appearance.playoffPlaces);

    if (!document.body.classList.contains("page-standings") || appearance.playoffLineEnabled === false) {
      return;
    }

    tables = Array.prototype.slice.call(document.querySelectorAll("table[width]")).filter(function (table) {
      return table.querySelector("td.header") && table.querySelector("td.main a.linkmain, td.main a.linkhuman");
    });

    tables.forEach(function (table) {
      var rows = Array.prototype.slice.call(table.querySelectorAll("tr")).filter(function (row) {
        var teamLink = row.querySelector("td.main a.linkmain, td.main a.linkhuman");
        return teamLink && teamLink.closest("table") === table;
      });

      rows.forEach(function (row) {
        row.classList.remove("race-champion", "race-promoted", "race-relegated", "playoff-cutoff");
      });

      if (places > 0 && rows.length >= places) {
        rows[places - 1].classList.add("playoff-cutoff");
      }
    });
  }

  function enhanceClassicBoxScoreLinks() {
    var boxScorePath;
    if (!core.paths || /(?:\/|\\)00-supercup(?:\/|\\)/i.test(window.location.pathname)) {
      return;
    }
    boxScorePath = core.paths.unifiedBoxScore ||
      String(core.paths.mainIndex || "/index.htm").replace(/index\.htm(?:\?.*)?$/i, "") + "00-assets/html/match-centre.htm";

    Array.prototype.slice.call(document.querySelectorAll('a[href*="boxes/box"]')).forEach(function (link) {
      var href = String(link.getAttribute("href") || "");
      var match;
      if (/00-supercup/i.test(href)) {
        return;
      }
      match = href.match(/box\d+-\d+/i);
      if (!match) {
        return;
      }
      link.href = boxScorePath + "?game=" + encodeURIComponent(match[0].toLowerCase());
      link.title = link.title || "Open unified box score";
    });
  }

  document.addEventListener("DOMContentLoaded", function () {
    markClassicPage();

    if (core.isRosterPage()) {
      core.ensureViewport(core.ROSTER_VIEWPORT);
      document.body.classList.add("page-roster");
    } else if (core.isPlayerPage()) {
      document.body.classList.add("page-player");
    } else if (core.shouldUseLegacyViewport()) {
      core.ensureViewport(core.DEFAULT_VIEWPORT);
    }

    markStandingsPage();
    markTransactionsPage();
    markSchedulePage();
    enhanceStandingsPlayoffCutoffs();
    enhanceClassicBoxScoreLinks();
    enhanceClassicTeamHeader();
    applyRosterHeaderPhoto();
  });
})();
