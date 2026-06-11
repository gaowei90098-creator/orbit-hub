import { app } from 'electron'
import { join } from 'path'
import * as fs from 'fs'

class AppStore {
  private data: Record<string, any> = {}
  private filePath: string = ''
  private initialized: boolean = false

  init(): void {
    if (this.initialized) return
    try {
      const userDataPath = app.getPath('userData')
      this.filePath = join(userDataPath, 'config.json')
      this.load()
      this.initialized = true
    } catch (e) {
      console.error('[Store] Init failed:', e)
    }
  }

  private load(): void {
    try {
      if (fs.existsSync(this.filePath)) {
        this.data = JSON.parse(fs.readFileSync(this.filePath, 'utf-8'))
      }
    } catch {}
  }

  private save(): void {
    try {
      fs.writeFileSync(this.filePath, JSON.stringify(this.data, null, 2))
    } catch {}
  }

  get(key: string, defaultValue?: any): any {
    this.init()
    return this.data[key] !== undefined ? this.data[key] : defaultValue
  }

  set(key: string, value: any): void {
    this.init()
    this.data[key] = value
    this.save()
  }

  getAll(): Record<string, any> {
    this.init()
    return { ...this.data }
  }
}

const appStore = new AppStore()
export { appStore as store }
