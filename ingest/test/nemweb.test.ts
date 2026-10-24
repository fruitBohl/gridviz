import { expect, test } from "bun:test";
import { parseListing, settlementFromName } from "../src/nemweb";

// Trimmed from the real listing at nemweb.com.au/Reports/Current/DispatchIS_Reports/
const html = `
<pre><A HREF="/Reports/CURRENT/">[To Parent Directory]</A><br><br>
<br>   Saturday, October 24, 2026 03:00 PM        21405 <A HREF="/Reports/CURRENT/DispatchIS_Reports/PUBLIC_DISPATCHIS_202610241505_0000000544621747.zip">PUBLIC_DISPATCHIS_202610241505_0000000544621747.zip</A>
<br>   Saturday, October 24, 2026 02:55 PM        21390 <A HREF="/Reports/CURRENT/DispatchIS_Reports/PUBLIC_DISPATCHIS_202610241500_0000000544621020.zip">PUBLIC_DISPATCHIS_202610241500_0000000544621020.zip</A>
<br>   Saturday, October 24, 2026 02:56 PM        21390 <A HREF="/Reports/CURRENT/DispatchIS_Reports/PUBLIC_DISPATCHIS_202610241500_0000000544621099.zip">PUBLIC_DISPATCHIS_202610241500_0000000544621099.zip</A>
</pre>`;

test("parseListing returns files sorted by interval, with absolute URLs", () => {
  const files = parseListing(html);
  expect(files.map((f) => f.settlementDate)).toEqual([
    "2026-10-24T15:00:00+10:00",
    "2026-10-24T15:05:00+10:00",
  ]);
  expect(files[1].url).toBe(
    "https://nemweb.com.au/Reports/CURRENT/DispatchIS_Reports/PUBLIC_DISPATCHIS_202610241505_0000000544621747.zip",
  );
});

test("a republished interval keeps the higher sequence number", () => {
  expect(parseListing(html)[0].name).toBe("PUBLIC_DISPATCHIS_202610241500_0000000544621099.zip");
});

test("settlementFromName", () => {
  expect(settlementFromName("PUBLIC_DISPATCHIS_202610250000_0000000544700000.zip")).toBe(
    "2026-10-25T00:00:00+10:00",
  );
  expect(() => settlementFromName("PUBLIC_DISPATCH_SCADA_202610250000_1.zip")).toThrow();
});
