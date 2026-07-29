(function () {
  "use strict";

  var core = window.LeagueSiteCore;
  var LeagueSettings = window.LeagueSettings || {};
  var siteConfig = window.LeagueSiteConfig || {};
  var MENU_STYLE_ID = "league-menu-enhancement-styles";
  var RESPONSIVE_MENU_STYLE_ID = "responsive-menu-toggle-styles";
  var MENU_BREAKPOINT = 760;

  if (!core) {
    return;
  }

  function featureEnabled(name) {
    return core.isFeatureEnabled ? core.isFeatureEnabled(name) : true;
  }

  function isParentCompactWidth(parentWindow) {
    var screenWidth = parentWindow.screen && parentWindow.screen.width ? parentWindow.screen.width : parentWindow.innerWidth;
    return Math.min(parentWindow.innerWidth, screenWidth) <= MENU_BREAKPOINT;
  }

  function syncResponsiveMenuState(button) {
    var parentWindow;
    var isNarrow;

    try {
      parentWindow = window.parent;
      isNarrow = isParentCompactWidth(parentWindow);
    } catch (error) {
      return;
    }

    if (!isNarrow) {
      core.setParentMenuOpen(true);
      button.hidden = true;
      parentWindow.__leagueMenuUserToggled = false;
      return;
    }

    if (!parentWindow.__leagueMenuUserToggled) {
      core.setParentMenuOpen(false);
    }

    button.hidden = false;
    button.setAttribute("aria-expanded", String(core.isParentMenuOpen()));
  }

  function ensureResponsiveMenuToggleStyles() {
    if (document.getElementById(RESPONSIVE_MENU_STYLE_ID)) {
      return;
    }

    var style = document.createElement("style");
    style.id = RESPONSIVE_MENU_STYLE_ID;
    style.textContent = [
      ".league-menu-hamburger { position: fixed; top: 8px; left: 8px; z-index: 3000; width: 36px; height: 34px; border: 1px solid rgba(255,255,255,0.24); border-radius: 8px; background: var(--league-primary, #111b36); color: var(--league-on-primary, #ffffff); box-shadow: 0 4px 14px rgba(15, 23, 42, 0.22); cursor: pointer; font: 800 18px/1 Inter, Tahoma, Arial, sans-serif; }",
      ".league-menu-hamburger:hover { background: #17274b; }",
      ".league-menu-hamburger[hidden] { display: none; }"
    ].join("");
    document.head.appendChild(style);
  }

  function initResponsiveFrameMenu() {
    var parentDocument = core.getParentShellDocument();
    var button;

    if (
      !parentDocument ||
      core.isMenuPage() ||
      document.querySelector(".league-menu-hamburger") ||
      parentDocument.querySelector(".site-menu-toggle")
    ) {
      return;
    }

    ensureResponsiveMenuToggleStyles();
    button = document.createElement("button");
    button.className = "league-menu-hamburger";
    button.type = "button";
    button.setAttribute("aria-label", "Toggle league menu");
    button.textContent = "\u2630";
    document.body.appendChild(button);

    button.addEventListener("click", function () {
      var parentWindow = window.parent;
      var nextOpen = !core.isParentMenuOpen();

      parentWindow.__leagueMenuUserToggled = true;
      core.setParentMenuOpen(nextOpen);
      button.setAttribute("aria-expanded", String(nextOpen));
    });

    window.__syncLeagueMenuButton = function () {
      syncResponsiveMenuState(button);
    };
    syncResponsiveMenuState(button);
    window.setInterval(function () {
      syncResponsiveMenuState(button);
    }, 500);

    try {
      window.parent.addEventListener("resize", function () {
        syncResponsiveMenuState(button);
      });
    } catch (error) {
      window.addEventListener("resize", function () {
        syncResponsiveMenuState(button);
      });
    }
  }

  function ensureCapReportMenuLink() {
    if (!core.isMenuPage()) {
      return;
    }

    var menuTable = document.querySelector("body > table");
    if (!menuTable || menuTable.querySelector('a[href="capreport.htm"]')) {
      return;
    }

    var anchor = menuTable.querySelector('a[href="injuries.htm"]');
    var row = document.createElement("tr");
    var cell = document.createElement("td");
    var link = document.createElement("a");

    row.setAttribute("valign", "top");
    link.className = "menulink";
    link.target = "data";
    link.href = "capreport.htm";
    link.textContent = "Cap Report";
    cell.appendChild(link);
    row.appendChild(cell);

    if (anchor && anchor.parentNode && anchor.parentNode.parentNode && anchor.parentNode.parentNode.parentNode === menuTable) {
      anchor.parentNode.parentNode.insertAdjacentElement("afterend", row);
      return;
    }

    menuTable.appendChild(row);
  }

  function ensureDepthChartsMenuLink() {
    if (!core.isMenuPage()) {
      return;
    }

    var menuTable = document.querySelector("body > table");
    if (!menuTable || menuTable.querySelector('a[href="00-assets/html/depthcharts.htm"], a[href="/00-assets/html/depthcharts.htm"]')) {
      return;
    }

    var anchor = menuTable.querySelector('a[href="capreport.htm"]') || menuTable.querySelector('a[href="injuries.htm"]');
    var row = document.createElement("tr");
    var cell = document.createElement("td");
    var link = document.createElement("a");

    row.setAttribute("valign", "top");
    link.className = "menulink";
    link.target = "data";
    link.href = core.paths.depthCharts;
    link.textContent = "Depth Charts";
    cell.appendChild(link);
    row.appendChild(cell);

    if (anchor && anchor.parentNode && anchor.parentNode.parentNode && anchor.parentNode.parentNode.parentNode === menuTable) {
      anchor.parentNode.parentNode.insertAdjacentElement("afterend", row);
      return;
    }

    menuTable.appendChild(row);
  }

  function ensureTradeToolMenuLink() {
    if (!core.isMenuPage()) {
      return;
    }

    var menuTable = document.querySelector("body > table");
    if (!menuTable || menuTable.querySelector('a[href$="trade-tool.htm"]')) {
      return;
    }

    var anchor = menuTable.querySelector('a[href$="depthcharts.htm"]') ||
      menuTable.querySelector('a[href="capreport.htm"]') ||
      menuTable.querySelector('a[href="injuries.htm"]');
    var row = document.createElement("tr");
    var cell = document.createElement("td");
    var link = document.createElement("a");

    row.setAttribute("valign", "top");
    link.className = "menulink";
    link.target = "data";
    link.href = core.paths.tradeTool;
    link.textContent = "Trade Tool";
    cell.appendChild(link);
    row.appendChild(cell);

    if (anchor && anchor.parentNode && anchor.parentNode.parentNode && anchor.parentNode.parentNode.parentNode === menuTable) {
      anchor.parentNode.parentNode.insertAdjacentElement("afterend", row);
      return;
    }

    menuTable.appendChild(row);
  }

  function ensureLeagueMenuStyles() {
    if (document.getElementById(MENU_STYLE_ID)) {
      return;
    }

    var style = document.createElement("style");
    style.id = MENU_STYLE_ID;
    style.textContent = [
      "body.menu-body { background: var(--league-primary, #111b36) !important; color: var(--league-on-primary, #ffffff); font-family: 'Inter', Tahoma, Arial, sans-serif; font-size: 10.8pt; line-height: 1.16; margin: 0; padding: 0; overflow-x: hidden; }",
      ".league-menu-shell { display: flex; flex-direction: column; gap: 0; }",
      ".league-menu-link, .league-menu-toggle { font-family: 'Inter', Tahoma, Arial, sans-serif; text-decoration: none; }",
      ".league-menu-link { color: #ffffff; display: block; font-size: 9.8pt; font-weight: 600; line-height: 1.08; padding: 6px 7px 6px 9px; }",
      ".league-menu-link:hover { background: rgba(255, 255, 255, 0.08); color: #ffffff; text-decoration: none; }",
      ".league-menu-link--accent { color: #d4af5a; }",
      ".league-menu-link--accent:hover { color: #e3c777; }",
      ".league-menu-feature { align-items: center; background: var(--league-primary, #111b36); color: var(--league-on-primary, #ffffff) !important; display: flex; justify-content: center; min-height: 42px; padding: 5px 2px; }",
      ".league-menu-feature:hover { background: rgba(255, 255, 255, 0.08); }",
      ".league-menu-feature-row { align-items: center; border-bottom: 1px solid rgba(148, 163, 184, 0.45); display: flex; justify-content: center; min-height: 50px; padding: 5px 7px; }",
      ".league-menu-logo { display: block; max-width: 84px; width: 100%; max-height: 38px; object-fit: contain; filter: none; }",
      ".league-menu-logo--supercup { filter: none; }",
      ".league-menu-eslm-logo { display: block; max-width: 94px; width: 100%; max-height: 22px; object-fit: contain; object-position: left center; filter: brightness(0) invert(1); }",
      ".league-menu-eslm-logo--supercup { filter: brightness(0) saturate(100%) invert(76%) sepia(39%) saturate(744%) hue-rotate(356deg) brightness(95%) contrast(94%); }",
      ".league-menu-back-link { align-items: center; border: 1px solid rgba(212, 175, 90, 0.45); border-radius: 999px; color: #d4af5a; display: inline-flex; flex: 0 0 auto; font-size: 6.8pt; font-weight: 800; letter-spacing: 0.08em; line-height: 1; margin-left: 6px; padding: 5px 8px; text-decoration: none; text-transform: uppercase; white-space: nowrap; }",
      ".league-menu-back-link:hover { background: rgba(212, 175, 90, 0.12); color: #e3c777; text-decoration: none; }",
      ".league-menu-fallback { color: #ffffff; font: 800 11pt/1 Inter, Tahoma, Arial, sans-serif; letter-spacing: 0.05em; text-transform: uppercase; }",
      ".league-menu-group { border-bottom: 1px solid rgba(148, 163, 184, 0.24); overflow: hidden; }",
      ".league-menu-toggle { align-items: center; background: var(--league-primary, #111b36); border: 0; color: var(--league-on-primary, #94a3b8); cursor: pointer; display: flex; font-size: 8.7pt; font-weight: 800; justify-content: space-between; letter-spacing: 0.09em; padding: 7px 7px 3px 9px; text-align: left; text-transform: uppercase; width: 100%; }",
      ".league-menu-toggle:hover { background: rgba(255, 255, 255, 0.08); }",
      ".league-menu-shell--supercup .league-menu-toggle { color: #d4af5a; }",
      ".league-menu-toggle::after { content: '-'; font-weight: 800; }",
      ".league-menu-group.is-collapsed .league-menu-toggle::after { content: '+'; }",
      ".league-menu-links { display: flex; flex-direction: column; gap: 0; padding-top: 0; }",
      ".league-menu-group.is-collapsed .league-menu-links { display: none; }",
      "@media (max-height: 680px) { .league-menu-link { font-size: 9.2pt; padding: 5px 6px 5px 8px; } .league-menu-toggle { font-size: 8.1pt; padding: 6px 6px 2px 8px; } .league-menu-feature-row { min-height: 42px; padding-left: 6px; padding-right: 6px; } .league-menu-feature { min-height: 34px; } .league-menu-logo { max-height: 32px; } }",
      "html.league-pref-density-compact .league-menu-link { padding-top: 4px; padding-bottom: 4px; }",
      "html.league-pref-density-compact .league-menu-toggle { padding-top: 5px; padding-bottom: 2px; }",
      "html.league-pref-density-spacious .league-menu-link { padding-top: 8px; padding-bottom: 8px; }",
      "html.league-pref-density-spacious .league-menu-toggle { padding-top: 9px; padding-bottom: 4px; }",
      "@media (max-height: 680px) { html.league-pref-density-compact .league-menu-link { padding-top: 3px; padding-bottom: 3px; } html.league-pref-density-compact .league-menu-toggle { padding-top: 4px; padding-bottom: 1px; } }"
    ].join("");
    document.head.appendChild(style);
  }

  function makeMenuLink(label, href, className) {
    var link = document.createElement("a");
    link.className = className || "league-menu-link";
    link.target = "data";
    link.href = href;
    link.textContent = label;
    link.addEventListener("click", function (event) {
      if (link.target !== "data") {
        return;
      }
      try {
        if (window.parent && window.parent.frames && window.parent.frames.data) {
          event.preventDefault();
          window.parent.frames.data.location.href = link.getAttribute("href");
        }
      } catch (error) {
        // Let default navigation proceed when frame access is blocked.
      }
    });
    return link;
  }

  function makeLeagueLogoLink() {
    var link = makeMenuLink("", "standings.htm", "league-menu-link league-menu-feature");
    var logo = document.createElement("img");
    var fallback = document.createElement("span");

    logo.className = "league-menu-logo";
    logo.src = core.paths.leagueLogo;
    logo.alt = (siteConfig.league && siteConfig.league.name) || "League";

    fallback.className = "league-menu-fallback";
    fallback.textContent = (siteConfig.league && siteConfig.league.shortName) || "LG";

    logo.addEventListener("error", function () {
      logo.remove();
      if (!link.contains(fallback)) {
        link.appendChild(fallback);
      }
    });

    link.appendChild(logo);
    return link;
  }

  function makeBackToIndexLink(label, className) {
    var link = makeMenuLink(label || "Back to Index", core.paths.mainIndex, className || "league-menu-link");
    link.target = "_top";
    return link;
  }

  function makeMenuGroup(title, links, options) {
    var section = document.createElement("section");
    var toggle = document.createElement("button");
    var linkWrap = document.createElement("div");
    var opts = options || {};
    var isCollapsed = !!opts.collapsed;

    section.className = "league-menu-group";
    if (isCollapsed) {
      section.classList.add("is-collapsed");
    }
    toggle.className = "league-menu-toggle";
    toggle.type = "button";
    toggle.setAttribute("aria-expanded", String(!isCollapsed));
    toggle.textContent = title;
    linkWrap.className = "league-menu-links";

    links.forEach(function (link) {
      var menuLink = makeMenuLink(link.label, link.href);

      if (link.target) {
        menuLink.target = link.target;
      }

      if (link.className) {
        String(link.className)
          .split(/\s+/)
          .filter(Boolean)
          .forEach(function (name) {
            menuLink.classList.add(name);
          });
      }

      linkWrap.appendChild(menuLink);
    });

    toggle.addEventListener("click", function () {
      var collapsed = section.classList.toggle("is-collapsed");
      toggle.setAttribute("aria-expanded", String(!collapsed));
    });

    section.appendChild(toggle);
    section.appendChild(linkWrap);
    return section;
  }

  function enhanceLeagueMenu() {
    if (!core.isMenuPage() || document.querySelector(".league-menu-shell")) {
      return;
    }

    ensureLeagueMenuStyles();
    document.body.className = (document.body.className ? document.body.className + " " : "") + "menu-body";
    document.body.setAttribute("bgcolor", (siteConfig.theme && siteConfig.theme.primary) || "#111b36");

    var groups = [
      {
        title: "League",
        links: [
          { label: "Standings", href: "standings.htm" },
          { label: "Schedule", href: "schedule.htm" },
          { label: "League Leaders", href: "leaders.htm" },
          { label: "Team Leaders", href: "teamleaders.htm" },
          { label: "Transactions", href: "transactions.htm" },
          { label: "Match Centre", href: core.paths.matchCentre || "00-assets/html/match-centre.htm" }
        ]
      },
      {
        title: "Teams",
        links: [
          { label: "Injuries", href: "injuries.htm" },
          { label: "Cap Report", href: "capreport.htm" },
          { label: "Free Agents", href: featureEnabled("playerDatabase") ? core.paths.playerDatabase + "?status=free_agent" : "freeagents.htm" },
          { label: "Potential FAs", href: featureEnabled("playerDatabase") ? core.paths.playerDatabase + "?status=potential_fa" : "potentialfreeagents.htm" }
        ]
      },
      {
        title: "Tools",
        links: [
          { label: "Depth Charts", href: core.paths.depthCharts, feature: "tradeTools" },
          { label: "Camps", href: core.paths.camps, feature: "camps" },
          { label: "FA War Room", href: core.paths.faWarRoom, feature: "tradeTools" },
          { label: "Player Database", href: core.paths.playerDatabase, feature: "playerDatabase" },
          { label: "Player Compare", href: core.paths.playerCompare, feature: "playerDatabase" },
          { label: "Trade Tool", href: core.paths.tradeTool, feature: "tradeTools" },
          { label: "Training Camp", href: core.paths.trainingCamp, feature: "camps" }
        ]
      },
      {
        title: "Season",
        links: [
          { label: "Awards", href: "awards.htm" },
          { label: "Season Awards", href: "seasonawards.htm" },
          { label: "Past Champs", href: "champs.htm" }
        ]
      },
      {
        title: "Admin",
        links: [
          { label: "Settings", href: core.paths.settings },
          { label: "Human Coaches", href: "humancoaches.htm" }
        ]
      },
      {
        title: "Legacy",
        links: [
          { label: "Draft Preview", href: "draft.htm" },
          { label: "Available Staff", href: "staff.htm" },
          { label: "Waiver Wire", href: "waiverwire.htm" },
          { label: "Playoff Standings", href: "playoffstandings.htm" },
          { label: "Playoffs", href: "playoffs.htm" },
          { label: "Playoff Leaders", href: "playoffleaders.htm" }
        ],
        collapsed: true
      }
    ];

    if (
      siteConfig.navigation &&
      Array.isArray(siteConfig.navigation.groups)
    ) {
      groups = siteConfig.navigation.groups.map(function (group) {
        return {
          title: group.label,
          links: (group.items || []).filter(function (item) {
            return item.context === "both" || item.context === "league";
          }).map(function (item) {
            return {
              label: item.label,
              href: /^https:\/\//i.test(item.href) ? item.href : item.href,
              target: /^https:\/\//i.test(item.href) ? "_blank" : (item.page === "home" || item.page === "cup" ? "_top" : "data")
            };
          })
        };
      }).filter(function (group) {
        return group.links.length > 0;
      });
    }

    groups = groups.map(function (group) {
      return {
        title: group.title,
        links: (group.links || []).filter(function (link) {
          return !link.feature || featureEnabled(link.feature);
        }),
        collapsed: !!group.collapsed
      };
    }).filter(function (group) {
      return group.links.length > 0;
    });

    var shell = document.createElement("nav");
    var featureRow = document.createElement("div");

    shell.className = "league-menu-shell";
    shell.setAttribute("aria-label", "League navigation");
    featureRow.className = "league-menu-feature-row";
    featureRow.appendChild(makeLeagueLogoLink());
    shell.appendChild(featureRow);
    groups.forEach(function (group) {
      shell.appendChild(makeMenuGroup(group.title, group.links, { collapsed: !!group.collapsed }));
    });

    document.body.innerHTML = "";
    document.body.appendChild(shell);
  }

  function initMenuEnhancements() {
    core.enableMenuFrameScroll();
    initResponsiveFrameMenu();
    ensureCapReportMenuLink();
    ensureDepthChartsMenuLink();
    ensureTradeToolMenuLink();
    enhanceLeagueMenu();
    if (LeagueSettings.applySavedPreferences) {
      LeagueSettings.applySavedPreferences();
    }
  }

  window.LeagueMenuEnhancements = {
    init: initMenuEnhancements,
    enhanceLeagueMenu: enhanceLeagueMenu
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initMenuEnhancements);
  } else {
    initMenuEnhancements();
  }
})();
