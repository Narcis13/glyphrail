import {
  Plugin,
  WorkspaceLeaf,
  TextFileView,
  MarkdownRenderer,
  Notice,
  Setting,
  PluginSettingTab,
  App,
  TFile,
  Menu
} from "obsidian"
import { spawn } from "node:child_process"

const VIEW_TYPE_GLYPHRAIL = "glyphrail-rendered-view"
const GR_MD_EXTENSION = "gr.md"

interface GlyphrailSettings {
  grBinary: string
  bunBinary: string
  autoRender: boolean
  outputFormat: "markdown" | "html"
}

const DEFAULT_SETTINGS: GlyphrailSettings = {
  grBinary: "gr",
  bunBinary: "bun",
  autoRender: false,
  outputFormat: "markdown"
}

export default class GlyphrailPlugin extends Plugin {
  settings: GlyphrailSettings = DEFAULT_SETTINGS

  async onload() {
    await this.loadSettings()

    this.registerView(VIEW_TYPE_GLYPHRAIL, (leaf) => new GlyphrailRenderedView(leaf, this))

    this.addRibbonIcon("play-circle", "Render Glyphrail Document", async () => {
      const file = this.app.workspace.getActiveFile()
      if (!file || !file.path.endsWith(`.${GR_MD_EXTENSION}`)) {
        new Notice("Open a .gr.md file first")
        return
      }
      await this.renderActiveDocument()
    })

    this.addCommand({
      id: "render-document",
      name: "Render current .gr.md document",
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile()
        if (!file || !file.path.endsWith(`.${GR_MD_EXTENSION}`)) return false
        if (!checking) this.renderActiveDocument()
        return true
      }
    })

    this.addCommand({
      id: "render-document-to-file",
      name: "Render and save as Markdown",
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile()
        if (!file || !file.path.endsWith(`.${GR_MD_EXTENSION}`)) return false
        if (!checking) this.renderAndSave()
        return true
      }
    })

    this.addCommand({
      id: "validate-document",
      name: "Validate current .gr.md document",
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile()
        if (!file || !file.path.endsWith(`.${GR_MD_EXTENSION}`)) return false
        if (!checking) this.validateActiveDocument()
        return true
      }
    })

    this.registerEvent(
      this.app.workspace.on("file-menu", (menu: Menu, file: TFile) => {
        if (file.path.endsWith(`.${GR_MD_EXTENSION}`)) {
          menu.addItem((item) => {
            item.setTitle("Render with Glyphrail")
              .setIcon("play-circle")
              .onClick(() => this.renderDocument(file))
          })
        }
      })
    )

    this.addSettingTab(new GlyphrailSettingsTab(this.app, this))
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData())
  }

  async saveSettings() {
    await this.saveData(this.settings)
  }

  async renderActiveDocument() {
    const file = this.app.workspace.getActiveFile()
    if (!file) return
    await this.renderDocument(file)
  }

  async renderDocument(file: TFile) {
    const leaf = await this.getOrCreateRenderedView()
    const view = leaf.view as GlyphrailRenderedView
    view.setFile(file)
    view.setStatus("running")

    const vaultPath = (this.app.vault.adapter as any).basePath as string
    const filePath = `${vaultPath}/${file.path}`

    try {
      const result = await this.executeGr(["render", filePath, "--json"], vaultPath)
      const parsed = JSON.parse(result)

      if (parsed.ok) {
        view.setRendered(parsed.rendered, parsed.runId, parsed.templateWarnings ?? [])
        view.setStatus("completed")
      } else {
        view.setError(parsed.error ?? "Render failed")
        view.setStatus("failed")
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      view.setError(msg)
      view.setStatus("failed")
    }
  }

  async renderAndSave() {
    const file = this.app.workspace.getActiveFile()
    if (!file) return

    const vaultPath = (this.app.vault.adapter as any).basePath as string
    const filePath = `${vaultPath}/${file.path}`
    const outputPath = file.path.replace(/\.gr\.md$/, ".rendered.md")
    const outputFullPath = `${vaultPath}/${outputPath}`

    try {
      new Notice("Rendering document...")
      await this.executeGr(
        ["render", filePath, "--output", outputFullPath, "--json"],
        vaultPath
      )
      new Notice(`Rendered to ${outputPath}`)
    } catch (error) {
      new Notice(`Render failed: ${error instanceof Error ? error.message : error}`)
    }
  }

  async validateActiveDocument() {
    const file = this.app.workspace.getActiveFile()
    if (!file) return

    const vaultPath = (this.app.vault.adapter as any).basePath as string
    const filePath = `${vaultPath}/${file.path}`

    try {
      const result = await this.executeGr(
        ["document", "validate", filePath, "--json"],
        vaultPath
      )
      const parsed = JSON.parse(result)

      if (parsed.ok && parsed.valid) {
        new Notice("Document is valid")
      } else {
        const errorCount = parsed.errors?.length ?? 0
        const warningCount = parsed.warnings?.length ?? 0
        new Notice(`Validation: ${errorCount} errors, ${warningCount} warnings`)
      }
    } catch (error) {
      new Notice(`Validation failed: ${error instanceof Error ? error.message : error}`)
    }
  }

  private executeGr(args: string[], cwd: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const proc = spawn(this.settings.grBinary, args, {
        cwd,
        env: { ...process.env },
        shell: true
      })

      let stdout = ""
      let stderr = ""

      proc.stdout.on("data", (data: Buffer) => { stdout += data.toString() })
      proc.stderr.on("data", (data: Buffer) => { stderr += data.toString() })

      proc.on("close", (code: number | null) => {
        if (code === 0) {
          resolve(stdout)
        } else {
          // Try to extract JSON error from stdout first
          try {
            const parsed = JSON.parse(stdout)
            if (!parsed.ok) {
              resolve(stdout) // Let caller handle the error JSON
              return
            }
          } catch {
            // Not JSON, use stderr
          }
          reject(new Error(stderr || `gr exited with code ${code}`))
        }
      })

      proc.on("error", (err: Error) => {
        reject(new Error(`Failed to run '${this.settings.grBinary}': ${err.message}. Is Glyphrail installed?`))
      })
    })
  }

  private async getOrCreateRenderedView(): Promise<WorkspaceLeaf> {
    const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE_GLYPHRAIL)
    if (existing.length > 0) {
      this.app.workspace.revealLeaf(existing[0] as WorkspaceLeaf)
      return existing[0] as WorkspaceLeaf
    }

    const leaf = this.app.workspace.getRightLeaf(false)
    if (!leaf) throw new Error("Could not create view leaf")
    await leaf.setViewState({ type: VIEW_TYPE_GLYPHRAIL, active: true })
    this.app.workspace.revealLeaf(leaf)
    return leaf
  }
}

class GlyphrailRenderedView extends TextFileView {
  plugin: GlyphrailPlugin
  renderedContent = ""
  runId = ""
  status: "idle" | "running" | "completed" | "failed" = "idle"
  warnings: { line: number; message: string; severity: string }[] = []
  sourceFile: TFile | null = null
  contentEl: HTMLElement

  constructor(leaf: WorkspaceLeaf, plugin: GlyphrailPlugin) {
    super(leaf)
    this.plugin = plugin
    this.contentEl = this.containerEl.children[1] as HTMLElement
  }

  getViewType(): string {
    return VIEW_TYPE_GLYPHRAIL
  }

  getDisplayText(): string {
    return this.sourceFile ? `Rendered: ${this.sourceFile.basename}` : "Glyphrail Rendered"
  }

  getIcon(): string {
    return "file-text"
  }

  getViewData(): string {
    return this.renderedContent
  }

  setViewData(_data: string, _clear: boolean): void {
    // Not used — we render via setRendered()
  }

  clear(): void {
    this.renderedContent = ""
    this.runId = ""
    this.status = "idle"
    this.warnings = []
    this.sourceFile = null
    this.render()
  }

  setFile(file: TFile) {
    this.sourceFile = file
  }

  setStatus(status: "idle" | "running" | "completed" | "failed") {
    this.status = status
    this.render()
  }

  setRendered(content: string, runId: string, warnings: { line: number; message: string; severity: string }[]) {
    this.renderedContent = content
    this.runId = runId
    this.warnings = warnings
    this.render()
  }

  setError(message: string) {
    this.renderedContent = ""
    this.warnings = [{ line: 0, message, severity: "error" }]
    this.render()
  }

  private render() {
    const container = this.contentEl
    container.empty()
    container.addClass("glyphrail-view")

    // Toolbar
    const toolbar = container.createDiv({ cls: "glyphrail-toolbar" })

    if (this.sourceFile) {
      const rerunBtn = toolbar.createEl("button", { text: "Re-render" })
      rerunBtn.addEventListener("click", () => {
        if (this.sourceFile) {
          this.plugin.renderDocument(this.sourceFile)
        }
      })
    }

    const statusEl = toolbar.createSpan({ cls: `status ${this.status}` })
    statusEl.setText(
      this.status === "idle" ? "Ready" :
      this.status === "running" ? "Running..." :
      this.status === "completed" ? "Completed" :
      "Failed"
    )

    // Errors
    for (const w of this.warnings.filter((w) => w.severity === "error")) {
      container.createDiv({ cls: "glyphrail-error", text: w.message })
    }

    // Rendered content
    if (this.renderedContent) {
      const rendered = container.createDiv({ cls: "glyphrail-rendered" })
      MarkdownRenderer.render(
        this.app,
        this.renderedContent,
        rendered,
        this.sourceFile?.path ?? "",
        this.plugin
      )
    }

    // Run info
    if (this.runId) {
      const info = container.createDiv({ cls: "glyphrail-run-info" })
      info.setText(`Run: ${this.runId}`)
      if (this.warnings.length > 0) {
        const warnCount = this.warnings.filter((w) => w.severity === "warning").length
        if (warnCount > 0) {
          info.appendText(` | ${warnCount} warning${warnCount > 1 ? "s" : ""}`)
        }
      }
    }
  }
}

class GlyphrailSettingsTab extends PluginSettingTab {
  plugin: GlyphrailPlugin

  constructor(app: App, plugin: GlyphrailPlugin) {
    super(app, plugin)
    this.plugin = plugin
  }

  display() {
    const { containerEl } = this
    containerEl.empty()

    new Setting(containerEl)
      .setName("Glyphrail binary")
      .setDesc("Path to the gr/glyphrail CLI binary")
      .addText((text) =>
        text
          .setPlaceholder("gr")
          .setValue(this.plugin.settings.grBinary)
          .onChange(async (value) => {
            this.plugin.settings.grBinary = value || "gr"
            await this.plugin.saveSettings()
          })
      )

    new Setting(containerEl)
      .setName("Auto-render on open")
      .setDesc("Automatically render .gr.md files when opened")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.autoRender)
          .onChange(async (value) => {
            this.plugin.settings.autoRender = value
            await this.plugin.saveSettings()
          })
      )

    new Setting(containerEl)
      .setName("Output format")
      .setDesc("Default output format for rendered documents")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("markdown", "Markdown")
          .addOption("html", "HTML")
          .setValue(this.plugin.settings.outputFormat)
          .onChange(async (value) => {
            this.plugin.settings.outputFormat = value as "markdown" | "html"
            await this.plugin.saveSettings()
          })
      )
  }
}
