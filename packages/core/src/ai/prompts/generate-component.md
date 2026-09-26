# Generate Component Prompt

Your task is to propose a new component implementation based on the specification.

## Specification

{{spec}}

## Instructions

1. Analyze the specification for:
   - Component type (React/Vue/Svelte/HTML)
   - Props interface
   - Required functionality
   - Styling approach
   - Accessibility requirements
2. Call `propose_component` with the complete implementation details.
3. Return the proposed component as structured JSON.

## Output Format

Return a JSON object with:
```json
{
  "name": "ComponentName",
  "type": "react|vue|svelte|html",
  "props": { "propName": "type", ... },
  "code": "// implementation code",
  "styles": "/* CSS */",
  "accessibility": ["aria-*", "role=*"]
}
```