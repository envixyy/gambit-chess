/* Small opening-name table keyed by SAN move prefix. Longest matching prefix wins. */
window.OPENINGS = (function () {
  var raw = [
    ['e4', "King's Pawn Game"],
    ['e4 e5', "King's Pawn Game: Open Game"],
    ['e4 e5 Nf3', "King's Knight Opening"],
    ['e4 e5 Nf3 Nc6', "King's Knight Opening: Normal Variation"],
    ['e4 e5 Nf3 Nc6 Bb5', 'Ruy Lopez'],
    ['e4 e5 Nf3 Nc6 Bb5 a6', 'Ruy Lopez: Morphy Defense'],
    ['e4 e5 Nf3 Nc6 Bb5 Nf6', 'Ruy Lopez: Berlin Defense'],
    ['e4 e5 Nf3 Nc6 Bc4', 'Italian Game'],
    ['e4 e5 Nf3 Nc6 Bc4 Bc5', 'Italian Game: Giuoco Piano'],
    ['e4 e5 Nf3 Nc6 Bc4 Nf6', 'Italian Game: Two Knights Defense'],
    ['e4 e5 Nf3 Nc6 d4', 'Scotch Game'],
    ['e4 e5 Nf3 Nc6 Nc3 Nf6', 'Four Knights Game'],
    ['e4 e5 Nf3 Nf6', "Petrov's Defense"],
    ['e4 e5 Nf3 d6', 'Philidor Defense'],
    ['e4 e5 f4', "King's Gambit"],
    ['e4 e5 Nc3', 'Vienna Game'],
    ['e4 e5 Bc4', "Bishop's Opening"],
    ['e4 e5 d4', 'Center Game'],
    ['e4 c5', 'Sicilian Defense'],
    ['e4 c5 Nf3 d6', 'Sicilian Defense: Najdorf / Dragon family'],
    ['e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 a6', 'Sicilian Defense: Najdorf Variation'],
    ['e4 c5 Nf3 Nc6', 'Sicilian Defense: Old Sicilian'],
    ['e4 c5 Nf3 e6', 'Sicilian Defense: French Variation'],
    ['e4 c5 c3', 'Sicilian Defense: Alapin Variation'],
    ['e4 c5 Nc3', 'Sicilian Defense: Closed'],
    ['e4 e6', 'French Defense'],
    ['e4 e6 d4 d5', 'French Defense: Normal'],
    ['e4 e6 d4 d5 Nc3', 'French Defense: Classical'],
    ['e4 e6 d4 d5 e5', 'French Defense: Advance Variation'],
    ['e4 e6 d4 d5 exd5', 'French Defense: Exchange Variation'],
    ['e4 c6', 'Caro-Kann Defense'],
    ['e4 c6 d4 d5 e5', 'Caro-Kann Defense: Advance Variation'],
    ['e4 c6 d4 d5 Nc3 dxe4', 'Caro-Kann Defense: Classical'],
    ['e4 d5', 'Scandinavian Defense'],
    ['e4 d5 exd5 Qxd5', 'Scandinavian Defense: Main Line'],
    ['e4 Nf6', "Alekhine's Defense"],
    ['e4 d6', 'Pirc Defense'],
    ['e4 g6', 'Modern Defense'],
    ['d4', "Queen's Pawn Game"],
    ['d4 d5', "Queen's Pawn Game: Closed Game"],
    ['d4 d5 c4', "Queen's Gambit"],
    ['d4 d5 c4 dxc4', "Queen's Gambit Accepted"],
    ['d4 d5 c4 e6', "Queen's Gambit Declined"],
    ['d4 d5 c4 c6', 'Slav Defense'],
    ['d4 d5 Bf4', 'London System'],
    ['d4 d5 Nf3 Nf6 Bf4', 'London System'],
    ['d4 Nf6', 'Indian Defense'],
    ['d4 Nf6 c4 e6', 'Indian Defense: Normal'],
    ['d4 Nf6 c4 e6 Nc3 Bb4', 'Nimzo-Indian Defense'],
    ['d4 Nf6 c4 e6 Nf3 b6', "Queen's Indian Defense"],
    ['d4 Nf6 c4 g6', "King's Indian Defense"],
    ['d4 Nf6 c4 g6 Nc3 d5', 'Grünfeld Defense'],
    ['d4 Nf6 Bg5', 'Trompowsky Attack'],
    ['d4 Nf6 Nf3 g6', "King's Indian: Fianchetto"],
    ['d4 f5', 'Dutch Defense'],
    ['c4', 'English Opening'],
    ['c4 e5', 'English Opening: Reversed Sicilian'],
    ['c4 c5', 'English Opening: Symmetrical'],
    ['Nf3', 'Réti Opening'],
    ['Nf3 d5 g3', "King's Indian Attack"],
    ['Nf3 d5 c4', 'Réti Opening: Queen\'s Gambit Transposition'],
    ['f4', "Bird's Opening"],
    ['b3', 'Nimzo-Larsen Attack'],
    ['g3', 'Hungarian Opening'],
    ['b4', 'Polish Opening'],
    ['e4 e5 Qh5', 'Parham Attack'],
    ['f3', 'Barnes Opening'],
    ['Nc3', 'Dunst Opening']
  ];
  var map = {};
  raw.forEach(function (r) { map[r[0]] = r[1]; });
  return {
    /** name only if this exact move sequence is a known line (used for "book move" in reviews) */
    exact: function (sans) { return map[sans.join(' ').replace(/[+#]/g, '')] || ''; },
    /** name for a SAN move array, or '' */
    find: function (sans) {
      for (var n = Math.min(sans.length, 14); n >= 1; n--) {
        var key = sans.slice(0, n).join(' ').replace(/[+#]/g, '');
        if (map[key]) return map[key];
      }
      return '';
    }
  };
})();
