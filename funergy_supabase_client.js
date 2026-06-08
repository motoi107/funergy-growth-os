// ============================================================
// Funergy Growth OS — Supabase クライアント
// GitHub Pages の既存HTMLに <script> タグで読み込むだけでOK
//
// 使い方:
//   <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
//   <script src="./funergy_supabase_client.js"></script>
// ============================================================

const SUPABASE_URL = 'https://zvvywrljbmwvaxoktaxk.supabase.co'  // ← 自分のURLに変更
const SUPABASE_ANON_KEY = 'sb_publishable_X4zXLvx9rnDhLTjV5snkCw_zr0J_cpF'                   // ← 自分のkeyに変更

const { createClient } = supabase
const db = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

// ============================================================
// 認証
// ============================================================
const Auth = {

  // Magic Linkでログイン（パスワード不要）
  async signIn(email) {
    const { error } = await db.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: window.location.origin }
    })
    if (error) throw error
    return '✅ メールを送りました。リンクをクリックしてログインしてください。'
  },

  // ログアウト
  async signOut() {
    await db.auth.signOut()
    window.location.reload()
  },

  // 現在のユーザー + employeeレコード取得
  async getMe() {
    const { data: { user } } = await db.auth.getUser()
    if (!user) return null
    const { data: employee } = await db
      .from('employees')
      .select('*, stores!primary_store_id(id, name, color)')
      .eq('auth_user_id', user.id)
      .single()
    return employee
  },

  // セッション変化を監視（ページロード時に呼ぶ）
  onAuthChange(callback) {
    db.auth.onAuthStateChange(async (event, session) => {
      if (session) {
        const me = await Auth.getMe()
        callback(event, me)
      } else {
        callback(event, null)
      }
    })
  }
}

// ============================================================
// 店舗
// ============================================================
const Stores = {

  // アクセス可能な店舗一覧
  async list() {
    const { data, error } = await db
      .from('stores')
      .select('*')
      .eq('status', 'active')
      .order('id')
    if (error) throw error
    return data
  }
}

// ============================================================
// Daily Ops タスク
// ============================================================
const DailyOps = {

  // その日のタスク一覧を取得（テンプレート + ログをマージ）
  async getTasksForDate(storeId, date = new Date().toISOString().split('T')[0]) {
    const [{ data: templates }, { data: logs }] = await Promise.all([
      db.from('ops_task_templates')
        .select('*')
        .eq('store_id', storeId)
        .eq('is_active', true)
        .order('phase')
        .order('sort_order'),
      db.from('daily_ops_logs')
        .select('*, completed_by_emp:employees!completed_by(display_name), approved_by_emp:employees!approved_by(display_name)')
        .eq('store_id', storeId)
        .eq('ops_date', date)
    ])

    // テンプレートにログをマージして返す
    return (templates || []).map(tmpl => {
      const log = (logs || []).find(l => l.template_id === tmpl.id)
      return {
        ...tmpl,
        log_id:       log?.id || null,
        status:       log?.status || 'pending',
        comment:      log?.comment || '',
        photo_urls:   log?.photo_urls || [],
        completed_at: log?.completed_at || null,
        completed_by: log?.completed_by_emp?.display_name || null,
        approved_at:  log?.approved_at || null,
        approved_by:  log?.approved_by_emp?.display_name || null,
        rejected_reason: log?.rejected_reason || null,
      }
    })
  },

  // タスクを完了にする
  async completeTask({ templateId, storeId, employeeId, comment, photoUrls = [], date }) {
    const ops_date = date || new Date().toISOString().split('T')[0]
    const { data, error } = await db
      .from('daily_ops_logs')
      .upsert({
        store_id:     storeId,
        template_id:  templateId,
        ops_date,
        status:       'pending_approval',  // 承認者ありの場合
        completed_by: employeeId,
        completed_at: new Date().toISOString(),
        comment,
        photo_urls:   photoUrls,
      }, { onConflict: 'store_id,template_id,ops_date' })
      .select()
      .single()
    if (error) throw error
    return data
  },

  // 承認者なしタスクを完了にする
  async completeTaskNoApproval({ templateId, storeId, employeeId, comment, photoUrls = [], date }) {
    const ops_date = date || new Date().toISOString().split('T')[0]
    const { data, error } = await db
      .from('daily_ops_logs')
      .upsert({
        store_id:     storeId,
        template_id:  templateId,
        ops_date,
        status:       'completed',
        completed_by: employeeId,
        completed_at: new Date().toISOString(),
        comment,
        photo_urls:   photoUrls,
      }, { onConflict: 'store_id,template_id,ops_date' })
      .select()
      .single()
    if (error) throw error
    return data
  },

  // 承認する
  async approveTask(logId, approverId) {
    const { data, error } = await db
      .from('daily_ops_logs')
      .update({
        status:      'approved',
        approved_by: approverId,
        approved_at: new Date().toISOString(),
      })
      .eq('id', logId)
      .select()
      .single()
    if (error) throw error
    return data
  },

  // 差戻し
  async rejectTask(logId, approverId, reason) {
    const { data, error } = await db
      .from('daily_ops_logs')
      .update({
        status:          'rejected',
        approved_by:     approverId,
        rejected_reason: reason,
      })
      .eq('id', logId)
      .select()
      .single()
    if (error) throw error
    return data
  },

  // Submit（Requiredタスクチェック → 未完了ログ記録）
  async submit(storeId, date) {
    const ops_date = date || new Date().toISOString().split('T')[0]
    // 未完了Requiredを記録（Supabase DB Function を呼ぶ）
    const { error } = await db.rpc('record_missed_tasks', {
      p_store_id: storeId,
      p_ops_date: ops_date,
    })
    if (error) throw error
    // Submitタイムスタンプを全ログに記録
    await db
      .from('daily_ops_logs')
      .update({ submitted_at: new Date().toISOString() })
      .eq('store_id', storeId)
      .eq('ops_date', ops_date)
      .is('submitted_at', null)
    return true
  },

  // 承認待ち一覧（AM/GMロール向け）
  async getPendingApprovals(storeIds) {
    const { data, error } = await db
      .from('daily_ops_logs')
      .select(`
        *,
        stores(name, color),
        ops_task_templates(name, phase, approver_role),
        completed_by_emp:employees!completed_by(display_name)
      `)
      .in('store_id', storeIds)
      .eq('status', 'pending_approval')
      .order('completed_at', { ascending: false })
    if (error) throw error
    return data
  },

  // リアルタイム購読（承認が来たら即UI更新）
  subscribeToStore(storeId, date, callback) {
    return db
      .channel(`ops-${storeId}-${date}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'daily_ops_logs',
        filter: `store_id=eq.${storeId}`,
      }, callback)
      .subscribe()
  }
}

// ============================================================
// Goal管理
// ============================================================
const Goals = {

  async list(storeId, type = null) {
    let q = db
      .from('goals')
      .select('*')
      .eq('store_id', storeId)
      .eq('is_active', true)
      .order('created_at')
    if (type) q = q.eq('type', type)
    const { data, error } = await q
    if (error) throw error
    return data
  },

  async create({ storeId, type, title, unit, targetValue, currentValue = 0, color, linkedTemplateId, targetDate, targetWeek, targetMonth, createdBy }) {
    const { data, error } = await db
      .from('goals')
      .insert({
        store_id:           storeId,
        type,
        title,
        unit,
        target_value:       targetValue,
        current_value:      currentValue,
        color,
        linked_template_id: linkedTemplateId || null,
        target_date:        targetDate || null,
        target_week:        targetWeek || null,
        target_month:       targetMonth || null,
        created_by:         createdBy,
      })
      .select()
      .single()
    if (error) throw error
    return data
  },

  async updateProgress(goalId, currentValue) {
    const pct = null  // DBで計算しない、フロントで計算
    const isAchieved = false  // フロントから渡す想定
    const { data, error } = await db
      .from('goals')
      .update({
        current_value: currentValue,
        is_achieved:   currentValue >= (await db.from('goals').select('target_value').eq('id', goalId).single()).data?.target_value,
        achieved_at:   new Date().toISOString(),
      })
      .eq('id', goalId)
      .select()
      .single()
    if (error) throw error
    return data
  },

  async delete(goalId) {
    const { error } = await db.from('goals').update({ is_active: false }).eq('id', goalId)
    if (error) throw error
  }
}

// ============================================================
// 未完了ログ
// ============================================================
const MissedLogs = {

  // 店舗・スタッフ別の未完了回数
  async getSummary(storeId, templateId) {
    const { data, error } = await db
      .from('missed_task_logs')
      .select('*')
      .eq('store_id', storeId)
      .eq('template_id', templateId)
      .order('created_at', { ascending: false })
    if (error) throw error
    return data
  },

  // 設定（閾値）取得
  async getSettings(storeId) {
    const { data, error } = await db
      .from('missed_task_settings')
      .select('*')
      .eq('store_id', storeId)
      .single()
    if (error) throw error
    return data
  },

  // 設定更新（SL以上のみ）
  async updateSettings(storeId, { warnThreshold, meetingThreshold }, updatedBy) {
    const { data, error } = await db
      .from('missed_task_settings')
      .update({
        warn_threshold:    warnThreshold,
        meeting_threshold: meetingThreshold,
        updated_by:        updatedBy,
        updated_at:        new Date().toISOString(),
      })
      .eq('store_id', storeId)
      .select()
      .single()
    if (error) throw error
    return data
  }
}

// ============================================================
// 写真アップロード (Supabase Storage)
// ============================================================
const Storage = {
  async uploadPhoto(file, storeId, taskId) {
    const ext = file.name.split('.').pop()
    const path = `ops-photos/${storeId}/${taskId}/${Date.now()}.${ext}`
    const { error } = await db.storage.from('funergy-uploads').upload(path, file)
    if (error) throw error
    const { data } = db.storage.from('funergy-uploads').getPublicUrl(path)
    return data.publicUrl
  }
}

// ============================================================
// グローバルに公開
// ============================================================
window.FunergyOS = { db, Auth, Stores, DailyOps, Goals, MissedLogs, Storage }
console.log('✅ Funergy Growth OS SDK loaded')
