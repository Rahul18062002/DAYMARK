import { describe, expect, it } from "vitest";
import { clientIpFrom } from "@/server/client-ip";

const h = (xff?: string) => new Headers(xff === undefined ? {} : { "x-forwarded-for": xff });

describe("client IP behind the platform proxy", () => {
  it("takes the address just before the trusted proxy, counted from the right", () => {
    expect(clientIpFrom(h("198.51.100.20, 10.0.0.9"), 1)).toBe("198.51.100.20");
    expect(clientIpFrom(h("198.51.100.20"), 0)).toBe("198.51.100.20");
  });
  it("ignores anything the client prepended (spoofing)", () => {
    expect(clientIpFrom(h("6.6.6.6, 7.7.7.7, 198.51.100.20, 10.0.0.9"), 1)).toBe("198.51.100.20");
    expect(clientIpFrom(h("6.6.6.6, 198.51.100.20, 10.0.0.9"), 1)).toBe("198.51.100.20");
  });
  it("never trusts X-Real-IP (the platform passes a client-supplied one through)", () => {
    const headers = new Headers({ "x-real-ip": "1.2.3.4", "x-forwarded-for": "198.51.100.20, 10.0.0.9" });
    expect(clientIpFrom(headers, 1)).toBe("198.51.100.20");
    expect(clientIpFrom(new Headers({ "x-real-ip": "1.2.3.4" }), 1)).toBe("unknown");
  });
  it("handles IPv6, a short chain and junk", () => {
    expect(clientIpFrom(h("2001:db8::1, 10.0.0.9"), 1)).toBe("2001:db8::1");
    expect(clientIpFrom(h("10.0.0.9"), 1)).toBe("10.0.0.9"); // shorter than the hop count: best available, never out of range
    expect(clientIpFrom(h(""), 1)).toBe("unknown");
    expect(clientIpFrom(h("<script>, 10.0.0.9"), 1)).toBe("unknown");
    expect(clientIpFrom(h(), 1)).toBe("unknown");
  });
});
