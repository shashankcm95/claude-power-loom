---
kb_id: serialization/xml-parsing-jaxp
version: 1
tags:
  - serialization
  - xml
  - jaxp
  - xpath
  - parsing
sources_consulted:
  - "Baeldung tutorials (eugenp/tutorials) module: xml"
  - "Jakarta XML Binding 4.0 spec (jakarta.ee/specifications/xml-binding/4.0/)"
  - "XStream Security Aspects (x-stream.github.io/security.html)"
related:
  - serialization/jaxb-binding
  - serialization/xml-serializers
  - serialization/xml-xxe-security
  - serialization/json-querying
status: active
---

## Summary

**Concept**: XML parsing/processing without binding — the four JAXP models (DOM / SAX / StAX / XPath), third-party DOM/XPath libraries, and writing a `Document` to a file.
**Key APIs**: DOM `DocumentBuilderFactory`; SAX `DefaultHandler`; StAX `XMLEventReader`/`XMLStreamReader`/`XMLStreamWriter`; XPath `XPathFactory` → compile → `evaluate(doc, XPathConstants.NODESET)`; `TransformerFactory` → `Transformer` over `DOMSource`/`StreamResult`; dom4j/JDOM2/Jaxen/jOOX.
**Gotcha**: SAX `characters()` may fire multiple times per element (append to a buffer, never assign); XPath `text()` predicates fail on pretty-printed XML unless whitespace nodes are stripped; XPath built by string concatenation of user input is an XPath-injection surface.
**2026-currency**: JAXP DOM/SAX/StAX/XPath APIs are forward-portable and stable; XML pretty-printing still needs the Xalan `indent-amount` property (processor-specific).
**Sources**: Baeldung `xml` module.

## Quick Reference

**The four JAXP models**:

| Model | API | Shape |
|---|---|---|
| **DOM** | `DocumentBuilderFactory` | full in-memory tree, mutable |
| **SAX** | event-driven `DefaultHandler` | push, streaming |
| **StAX** | `XMLEventReader` (iterator) / `XMLStreamReader` (cursor); `XMLStreamWriter` to emit | pull, streaming |
| **XPath** | `XPathFactory` → compile → evaluate | query over a `Document` |

**XPath over DOM**:

```java
XPath xp = XPathFactory.newInstance().newXPath();
NodeList nl = (NodeList) xp.compile("//book[@id='x']")
        .evaluate(doc, XPathConstants.NODESET);
```

- Depth: absolute paths, attribute predicates `[@id='x']`, descendant axis `//`, functions `number(translate(...))`, namespace queries via a custom `NamespaceContext`.

**SAX**: subclass `DefaultHandler`; accumulate text across (possibly multiple) `characters` callbacks into a `StringBuilder`.

**StAX iterator**: `XMLInputFactory.createXMLEventReader(...)` → `nextEvent()`/`isStartElement()`/`asCharacters().getData()`. Cursor: `createXMLStreamReader(...)` → `next()`/`getLocalName()`/`getElementText()`.

**Write a Document to file**: `TransformerFactory` → `Transformer` over `DOMSource` → `StreamResult`; `OutputKeys.INDENT`/`OMIT_XML_DECLARATION` + the Xalan `{http://xml.apache.org/xslt}indent-amount` property.

**Third-party libs**: dom4j (`SAXReader` + `selectNodes` + `XMLWriter`/`OutputFormat.createPrettyPrint`), JDOM2 (`SAXBuilder` + `XPathFactory.instance().compile(expr, Filters.element())`), Jaxen (`DOMXPath` over a w3c DOM), jOOX (jQuery-style `$(doc).xpath(expr)`).

**Top gotchas**:

- SAX `characters()` may fire **multiple times** per element — append to a buffer, never assign.
- XPath `text()` predicates fail on pretty-printed XML unless whitespace/comment text nodes are stripped first.
- XPath built by string-concatenating user input is an **XPath-injection** surface (the corpus does not parameterize).
- XML pretty-printing is processor-specific — `OutputKeys.INDENT="yes"` alone is insufficient; needs the Xalan `indent-amount` property.

**Current (mid-2026)**: The JAXP DOM/SAX/StAX/XPath APIs are forward-portable and stable. The secure-read configuration (XXE hardening) is unchanged best practice — see `serialization/xml-xxe-security`.

## Full content

JAXP is the JDK's built-in XML processing toolkit, offering four models at different memory/control trade-offs.

### DOM, SAX, StAX

DOM (`DocumentBuilderFactory`) builds a full mutable in-memory tree — convenient but memory-heavy. SAX is an event-driven push parser: subclass `DefaultHandler` and react to start/end/characters callbacks. A key SAX gotcha: `characters()` may fire multiple times for one element's text, so accumulate into a `StringBuilder` rather than assigning. StAX is a pull parser with two APIs — the iterator `XMLEventReader` and the cursor `XMLStreamReader` — plus `XMLStreamWriter` to emit. Evidence: `xml/.../sax/SaxParserMain.java`, `xml/.../xml/stax/StaxParser.java`, `xml/.../xmlhtml/stax/StaxTransformer.java`.

### XPath

`XPathFactory.newInstance().newXPath().compile(expr).evaluate(doc, XPathConstants.NODESET)` queries a DOM. The corpus goes deep: absolute paths, attribute predicates, the descendant axis `//`, XPath functions (`number(translate(...))`), and namespace-aware queries via a custom `NamespaceContext`. A practical trap: `text()` predicates fail on pretty-printed XML until whitespace/comment text nodes are cleaned. A security trap: XPath assembled by concatenating user input (`"...[@tutId='" + id + "']"`) is an XPath-injection surface the tutorials do not parameterize. Evidence: `xml/.../xml/DefaultParser.java`.

### Third-party libraries and document writing

dom4j (`SAXReader`/`selectNodes`/`XMLWriter`), JDOM2 (`SAXBuilder` + `XPathFactory.instance().compile(expr, Filters.element())`), Jaxen (`DOMXPath`), and jOOX (jQuery-style `$(doc).xpath(...)`) provide alternative DOM/XPath ergonomics. Writing a `Document` to a file uses `TransformerFactory` → `Transformer` over a `DOMSource` → `StreamResult`, with `OutputKeys.INDENT`/`OMIT_XML_DECLARATION` and the Xalan `indent-amount` property for control. The corpus also renders XML→HTML four ways (JAXP/DOM, StAX, FreeMarker, Mustache). Evidence: `xml/.../{Dom4JParser,XMLDocumentWriter}.java`, `xml/.../xmlhtml/{jaxp,stax,freemarker,mustache}/*`.

### 2026 currency

- The JAXP DOM/SAX/StAX/XPath APIs are **forward-portable** — actively maintained in the JDK, pattern-stable. (inference; sourced negatively — no contradicting guidance found.)
- **XXE-hardening config is still best practice in 2026** — nothing in the JAXP secure-processing model changed to obsolete it (see `serialization/xml-xxe-security`). ([XStream Security Aspects — x-stream.github.io](https://x-stream.github.io/security.html))
- XPath-injection via string-concatenated user input remains a live class of bug; parameterize via variable resolvers / `XPathVariableResolver` rather than concatenation. (carries forward from the base.)
