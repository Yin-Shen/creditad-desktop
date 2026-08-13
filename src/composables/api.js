import axios from 'axios'

const API_BASE_URL = import.meta.env.VITE_API_URL || (window.electronAPI ? 'http://127.0.0.1:5001' : '')

const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: 10000
})

api.interceptors.response.use(
  res => res.data,
  error => {
    console.error("API Error:", error)
    return Promise.reject(error)
  }
)

export { API_BASE_URL }
export default api
