import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { defaultSection, parseSection, SECTION_IDS } from "./sections";

describe("sections", () => {
  it("parses valid hashes with or without the leading #", () => {
    for (const id of SECTION_IDS) {
      assert.equal(parseSection(`#${id}`, "launch"), id);
      assert.equal(parseSection(id, "launch"), id);
    }
  });

  it("falls back for empty, unknown, or mixed-case hashes", () => {
    assert.equal(parseSection("", "launch"), "launch");
    assert.equal(parseSection("#", "status"), "status");
    assert.equal(parseSection("#nope", "launch"), "launch");
    assert.equal(parseSection("#Status", "launch"), "launch");
  });

  it("defaults to status once published, launch before", () => {
    assert.equal(defaultSection(true), "status");
    assert.equal(defaultSection(false), "launch");
  });
});
