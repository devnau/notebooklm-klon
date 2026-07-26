import { describe, expect, it } from 'vitest';

import { checkUrl, isBlockedAddress } from './url-guard.js';

/**
 * Diese Tests sind die Absicherung gegen SSRF — die realistischste
 * Angriffsfläche der Anwendung, weil sie beliebige URLs für den Nutzer abruft
 * und auf einem Server mit Zugriff aufs interne Netz läuft.
 *
 * Jeder Fall hier ist ein bekannter Umgehungsversuch, kein konstruiertes
 * Beispiel.
 */

function expectRejected(url: string, reason?: string) {
  const result = checkUrl(url);
  expect(result.ok, `${url} hätte abgelehnt werden müssen`).toBe(false);
  if (!result.ok && reason) {
    expect(result.reason).toBe(reason);
  }
}

function expectAccepted(url: string) {
  const result = checkUrl(url);
  expect(
    result.ok,
    `${url} hätte akzeptiert werden müssen: ${result.ok ? '' : result.detail}`,
  ).toBe(true);
}

describe('Schemata', () => {
  it('lässt http und https durch', () => {
    expectAccepted('https://example.com/artikel');
    expectAccepted('http://example.com/artikel');
  });

  it('weist alles andere ab', () => {
    // file: liest lokale Dateien, gopher: erlaubt beliebige TCP-Nutzlast,
    // data: schmuggelt Inhalte ohne Netzwerkzugriff ein.
    expectRejected('file:///etc/passwd', 'unsupported_scheme');
    expectRejected('file://localhost/etc/shadow', 'unsupported_scheme');
    expectRejected('gopher://example.com:70/x', 'unsupported_scheme');
    expectRejected('ftp://example.com/datei.txt', 'unsupported_scheme');
    expectRejected('data:text/html,<script>alert(1)</script>', 'unsupported_scheme');
    expectRejected('javascript:alert(1)', 'unsupported_scheme');
    expectRejected('dict://example.com:11211/stat', 'unsupported_scheme');
  });
});

describe('Loopback', () => {
  it('weist localhost in allen Schreibweisen ab', () => {
    expectRejected('http://localhost/', 'blocked_host');
    expectRejected('http://LOCALHOST/', 'blocked_host');
    expectRejected('http://localhost./', 'blocked_host');
    expectRejected('http://ip6-localhost/', 'blocked_host');
  });

  it('weist 127.0.0.0/8 vollständig ab, nicht nur 127.0.0.1', () => {
    expectRejected('http://127.0.0.1/', 'loopback');
    expectRejected('http://127.0.0.2/', 'loopback');
    expectRejected('http://127.1.2.3/', 'loopback');
    expectRejected('http://127.255.255.254/', 'loopback');
  });

  it('weist 0.0.0.0 ab — führt auf manchen Systemen ebenfalls lokal', () => {
    expectRejected('http://0.0.0.0/', 'loopback');
  });

  it('weist IPv6-Loopback ab', () => {
    expectRejected('http://[::1]/', 'loopback');
    expectRejected('http://[::]/', 'loopback');
  });
});

describe('Metadaten-Endpunkte der Cloud-Anbieter', () => {
  it('weist 169.254.169.254 ab — der klassische Fall', () => {
    expectRejected('http://169.254.169.254/latest/meta-data/', 'link_local');
    expectRejected(
      'http://169.254.169.254/computeMetadata/v1/instance/service-accounts/',
      'link_local',
    );
  });

  it('weist den gesamten Link-Local-Bereich ab', () => {
    expectRejected('http://169.254.0.1/', 'link_local');
    expectRejected('http://169.254.255.255/', 'link_local');
  });

  it('weist die Namen der Metadaten-Dienste ab', () => {
    expectRejected('http://metadata.google.internal/', 'blocked_host');
    expectRejected('http://metadata/', 'blocked_host');
    expectRejected('http://instance-data/', 'blocked_host');
  });
});

describe('Private Netze', () => {
  it('weist RFC-1918-Bereiche ab', () => {
    expectRejected('http://10.0.0.1/', 'private_network');
    expectRejected('http://10.255.255.255/', 'private_network');
    expectRejected('http://192.168.1.1/', 'private_network');
    expectRejected('http://172.16.0.1/', 'private_network');
    expectRejected('http://172.31.255.255/', 'private_network');
  });

  it('lässt 172.15 und 172.32 durch — sie liegen außerhalb des Bereichs', () => {
    // Häufiger Implementierungsfehler: 172.* pauschal zu sperren.
    expectAccepted('http://172.15.0.1/');
    expectAccepted('http://172.32.0.1/');
  });

  it('weist Carrier-Grade NAT ab', () => {
    expectRejected('http://100.64.0.1/', 'private_network');
    expectRejected('http://100.127.255.255/', 'private_network');
  });

  it('lässt 100.63 und 100.128 durch', () => {
    expectAccepted('http://100.63.255.255/');
    expectAccepted('http://100.128.0.1/');
  });

  it('weist Multicast und reservierte Bereiche ab', () => {
    expectRejected('http://224.0.0.1/', 'private_network');
    expectRejected('http://255.255.255.255/', 'private_network');
  });

  it('weist private IPv6-Bereiche ab', () => {
    expectRejected('http://[fc00::1]/', 'unique_local');
    expectRejected('http://[fd12:3456::1]/', 'unique_local');
    expectRejected('http://[fe80::1]/', 'link_local');
  });

  it('weist IPv4-in-IPv6-Einbettungen ab', () => {
    // ::ffff:127.0.0.1 ist derselbe Host wie 127.0.0.1 — wer nur die
    // v4-Schreibweise prüft, hat hier eine Lücke.
    expectRejected('http://[::ffff:127.0.0.1]/', 'loopback');
    expectRejected('http://[::ffff:169.254.169.254]/', 'link_local');
    expectRejected('http://[::ffff:10.0.0.1]/', 'private_network');
    expectRejected('http://[64:ff9b::192.168.1.1]/', 'private_network');
  });

  it('weist Einbettungen auch in Hex-Schreibweise ab', () => {
    /*
     * Der eigentliche Stolperstein: der URL-Parser schreibt die Adresse um.
     * `::ffff:127.0.0.1` wird zu `::ffff:7f00:1`, bevor unsere Prüfung sie
     * überhaupt sieht. Die erste Fassung suchte nach der Punkt-Schreibweise
     * und ließ alle drei Adressen durch.
     */
    expectRejected('http://[::ffff:7f00:1]/', 'loopback');
    expectRejected('http://[::ffff:a9fe:a9fe]/', 'link_local');
    expectRejected('http://[::ffff:a00:1]/', 'private_network');
    expectRejected('http://[64:ff9b::c0a8:101]/', 'private_network');
  });

  it('weist 6to4-Einbettungen privater Adressen ab', () => {
    // 2002:<v4>::/16 — die eingebettete Adresse steht am Anfang, nicht am Ende.
    expectRejected('http://[2002:a00:1::1]/', 'private_network');
    expectRejected('http://[2002:7f00:1::1]/', 'loopback');
  });

  it('lässt öffentliche IPv6-Adressen durch', () => {
    // Gegenprobe zur Einbettungsprüfung: die letzten 32 Bit einer beliebigen
    // IPv6-Adresse sind gewöhnliche Adressbits. Sie pauschal als IPv4 zu
    // prüfen würde legitime Adressen zufällig sperren.
    expectAccepted('http://[2606:2800:220:1:248:1893:25c8:1946]/');
    expectAccepted('http://[2001:4860:4860::8888]/');
    // Letzte 32 Bit ergeben 10.0.0.1 — aber ohne Einbettungspräfix.
    expectAccepted('http://[2001:db8::a00:1]/');
  });

  it('behandelt verkürzte und ausgeschriebene Schreibweisen gleich', () => {
    expectRejected('http://[0:0:0:0:0:0:0:1]/', 'loopback');
    expectRejected('http://[fe80:0:0:0:0:0:0:1]/', 'link_local');
    expectRejected('http://[fd00:0:0:0:0:0:0:1]/', 'unique_local');
  });

  it('ignoriert einen Zone-Index', () => {
    // fe80::1%eth0 — der Zone-Index darf die Prüfung nicht aushebeln.
    expect(isBlockedAddress('fe80::1%eth0')).toBe('link_local');
  });
});

describe('Namen des internen Docker-Netzes', () => {
  it('weist die Dienstnamen des eigenen Stacks ab', () => {
    // Aus dem Worker-Container heraus sind diese Namen erreichbar — und
    // enthalten Datenbank und Storage.
    expectRejected('http://db:5432/', 'blocked_host');
    expectRejected('http://storage:5000/', 'blocked_host');
    expectRejected('http://auth:9999/', 'blocked_host');
    expectRejected('http://host.docker.internal/', 'blocked_host');
  });

  it('weist lokale Namenssuffixe ab', () => {
    expectRejected('http://nas.local/', 'blocked_host');
    expectRejected('http://drucker.internal/', 'blocked_host');
    expectRejected('http://irgendwas.localhost/', 'blocked_host');
    expectRejected('http://gerät.home.arpa/', 'blocked_host');
  });
});

describe('Ports', () => {
  it('lässt Web-Ports zu', () => {
    expectAccepted('https://example.com/');
    expectAccepted('http://example.com:80/');
    expectAccepted('https://example.com:443/');
    expectAccepted('http://example.com:8080/');
  });

  it('weist Ports interner Dienste ab', () => {
    // Auch auf einem öffentlichen Host: 6379 ist Redis, 5432 Postgres,
    // 9200 Elasticsearch. Ein Abruf dorthin ist kein Dokumentenimport.
    expectRejected('http://example.com:22/', 'non_standard_port');
    expectRejected('http://example.com:5432/', 'non_standard_port');
    expectRejected('http://example.com:6379/', 'non_standard_port');
    expectRejected('http://example.com:9200/', 'non_standard_port');
    expectRejected('http://example.com:11211/', 'non_standard_port');
  });
});

describe('Zugangsdaten in der URL', () => {
  it('weist Benutzername und Passwort ab', () => {
    // http://example.com@127.0.0.1/ wird von manchen Parsern als Host
    // example.com gelesen, von anderen als 127.0.0.1.
    expectRejected('http://nutzer@example.com/', 'credentials_in_url');
    expectRejected('http://nutzer:geheim@example.com/', 'credentials_in_url');
    expectRejected('http://example.com@127.0.0.1/', 'credentials_in_url');
  });
});

describe('Fehlerhafte Eingaben', () => {
  it('weist ab, was keine URL ist', () => {
    expectRejected('', 'invalid_url');
    expectRejected('   ', 'invalid_url');
    expectRejected('nur text', 'invalid_url');
    expectRejected('example.com', 'invalid_url'); // ohne Schema
    expectRejected('//example.com/', 'invalid_url'); // protokollrelativ
  });

  it('ignoriert umgebende Leerzeichen bei gültigen Adressen', () => {
    expectAccepted('  https://example.com/  ');
  });
});

describe('isBlockedAddress für aufgelöste IPs', () => {
  it('ist die zweite Stufe: prüft, worauf DNS zeigt', () => {
    // Genau hier greift der Schutz gegen einen DNS-Eintrag, der bewusst auf
    // eine interne Adresse zeigt — der Hostname allein sähe unauffällig aus.
    expect(isBlockedAddress('127.0.0.1')).toBe('loopback');
    expect(isBlockedAddress('169.254.169.254')).toBe('link_local');
    expect(isBlockedAddress('10.1.2.3')).toBe('private_network');
    expect(isBlockedAddress('::1')).toBe('loopback');
    expect(isBlockedAddress('fd00::1')).toBe('unique_local');
  });

  it('lässt öffentliche Adressen durch', () => {
    expect(isBlockedAddress('93.184.216.34')).toBeNull();
    expect(isBlockedAddress('8.8.8.8')).toBeNull();
    expect(isBlockedAddress('2606:2800:220:1:248:1893:25c8:1946')).toBeNull();
  });
});

describe('Gegenprobe: normale Quellen funktionieren', () => {
  it('akzeptiert typische Dokumentadressen', () => {
    expectAccepted('https://de.wikipedia.org/wiki/Informationsextraktion');
    expectAccepted('https://arxiv.org/abs/2301.00001');
    expectAccepted('https://www.gesetze-im-internet.de/bgb/__242.html');
    expectAccepted('https://example.com/pfad?frage=1&seite=2#abschnitt');
    expectAccepted('https://xn--bcher-kva.example/seite'); // Punycode
  });
});
