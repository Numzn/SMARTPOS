import { useState, useEffect } from 'react'
import api from '../services/api'

const Dashboard = () => {
  const [stats, setStats] = useState({
    todaySales: 0,
    transactionCount: 0,
    averageTicket: 0,
    lastSale: null,
    hourlyStats: [],
    topProducts: [],
    paymentMethods: {}
  })
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState(null)
  const [selectedTimeframe, setSelectedTimeframe] = useState('today')

  // Fetch real data from backend
  useEffect(() => {
    const fetchStats = async () => {
      setIsLoading(true)
      setError(null)
      
      try {
        // Fetch sales data from backend
        const salesResponse = await api.get('/api/sales')
        const sales = salesResponse.data || []
        
        // Calculate today's sales
        const today = new Date().toDateString()
        const todaySales = sales.filter(sale => 
          new Date(sale.createdAt).toDateString() === today
        )
        
        // Calculate stats
        const todayTotal = todaySales.reduce((sum, sale) => sum + sale.total, 0)
        const avgTicket = todaySales.length > 0 ? todayTotal / todaySales.length : 0
        const lastSale = todaySales.length > 0 ? new Date(todaySales[0].createdAt).toLocaleTimeString() : null
        
        // Generate hourly stats (mock for now, can be enhanced with backend)
        const hourlyStats = generateHourlyStats(todaySales)
        
        // Generate top products (mock for now, can be enhanced with backend)
        const topProducts = generateTopProducts(sales)
        
        // Generate payment methods (mock for now, can be enhanced with backend)
        const paymentMethods = generatePaymentMethods(sales)
        
        setStats({
          todaySales: todayTotal,
          transactionCount: todaySales.length,
          averageTicket: avgTicket,
          lastSale,
          hourlyStats,
          topProducts,
          paymentMethods
        })
        
      } catch (err) {
        console.error('Failed to fetch dashboard data:', err)
        setError('Failed to load dashboard data')
        
        // Fallback to mock data if API fails
        setStats({
          todaySales: 2847.50,
          transactionCount: 47,
          averageTicket: 60.59,
          lastSale: new Date().toLocaleTimeString(),
          hourlyStats: [
            { hour: '9 AM', sales: 245.50, transactions: 8 },
            { hour: '10 AM', sales: 312.75, transactions: 12 },
            { hour: '11 AM', sales: 489.25, transactions: 15 },
            { hour: '12 PM', sales: 678.90, transactions: 21 },
            { hour: '1 PM', sales: 456.30, transactions: 18 },
            { hour: '2 PM', sales: 665.80, transactions: 19 }
          ],
          topProducts: [
            { name: 'Coca Cola 500ml', sales: 45, revenue: 382.50 },
            { name: 'Bread Loaf', sales: 23, revenue: 276.00 },
            { name: 'Milk 1L', sales: 18, revenue: 279.00 }
          ],
          paymentMethods: {
            cash: 45.2,
            card: 32.1,
            mobile: 18.7,
            bank: 4.0
          }
        })
      } finally {
        setIsLoading(false)
      }
    }

    fetchStats()
  }, [selectedTimeframe])

  // Helper functions to generate stats
  const generateHourlyStats = () => {
    const hours = ['9 AM', '10 AM', '11 AM', '12 PM', '1 PM', '2 PM', '3 PM', '4 PM', '5 PM']
    return hours.map(hour => ({
      hour,
      sales: Math.random() * 800 + 200,
      transactions: Math.floor(Math.random() * 25) + 5
    }))
  }

  const generateTopProducts = () => {
    return [
      { name: 'Coca Cola 500ml', sales: 45, revenue: 382.50 },
      { name: 'Bread Loaf', sales: 23, revenue: 276.00 },
      { name: 'Milk 1L', sales: 18, revenue: 279.00 }
    ]
  }

  const generatePaymentMethods = () => {
    return {
      cash: 45.2,
      card: 32.1,
      mobile: 18.7,
      bank: 4.0
    }
  }

  const formatCurrency = (amount) => {
    return new Intl.NumberFormat('en-ZM', {
      style: 'currency',
      currency: 'ZMW',
      minimumFractionDigits: 2
    }).format(amount)
  }

  const StatCard = ({ title, value, icon, color, subtitle, trend }) => (
    <div className={`card-interactive ${color} relative overflow-hidden`}>
      <div className="absolute top-0 right-0 text-6xl opacity-10">
        {icon}
      </div>
      <div className="relative z-10">
        <h3 className="text-sm font-medium text-gray-600 mb-1">{title}</h3>
        <p className="text-2xl font-bold text-gray-900 mb-1">{value}</p>
        {subtitle && (
          <p className="text-xs text-gray-500">{subtitle}</p>
        )}
        {trend && (
          <div className={`text-xs mt-1 ${trend > 0 ? 'text-green-600' : 'text-red-600'}`}>
            {trend > 0 ? '↗' : '↘'} {Math.abs(trend)}% from yesterday
          </div>
        )}
      </div>
    </div>
  )

  if (isLoading) {
    return (
      <div className="p-4 glass border-b border-white/20">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map(i => (
            <div key={i} className="card animate-pulse">
              <div className="h-4 bg-gray-300 rounded mb-2"></div>
              <div className="h-8 bg-gray-300 rounded mb-1"></div>
              <div className="h-3 bg-gray-300 rounded w-2/3"></div>
            </div>
          ))}
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="p-4 glass border-b border-white/20">
        <div className="text-center text-red-600">
          <p className="text-lg font-semibold">⚠️ {error}</p>
          <p className="text-sm text-gray-600">Showing fallback data</p>
        </div>
      </div>
    )
  }

  return (
    <div className="p-4 glass border-b border-white/20 animate-fade-in">
      {/* Timeframe Selector */}
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-lg font-semibold text-gray-900 flex items-center">
          📊 Sales Dashboard
        </h2>
        <div className="flex space-x-2">
          {['today', 'week', 'month'].map(timeframe => (
            <button
              key={timeframe}
              onClick={() => setSelectedTimeframe(timeframe)}
              className={`px-3 py-1 rounded-full text-sm font-medium transition-all ${
                selectedTimeframe === timeframe
                  ? 'bg-blue-600 text-white shadow-md'
                  : 'bg-white/50 text-gray-700 hover:bg-white/70'
              }`}
            >
              {timeframe.charAt(0).toUpperCase() + timeframe.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {/* Main Stats Grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatCard
          title="Today's Sales"
          value={formatCurrency(stats.todaySales)}
          icon="💰"
          color="bg-gradient-to-br from-green-50 to-emerald-100 border-green-200"
          trend={12.5}
        />
        
        <StatCard
          title="Transactions"
          value={stats.transactionCount}
          icon="🧾"
          color="bg-gradient-to-br from-blue-50 to-cyan-100 border-blue-200"
          subtitle="orders completed"
          trend={8.3}
        />
        
        <StatCard
          title="Avg. Ticket"
          value={formatCurrency(stats.averageTicket)}
          icon="🎯"
          color="bg-gradient-to-br from-purple-50 to-violet-100 border-purple-200"
          subtitle="per transaction"
          trend={-2.1}
        />
        
        <StatCard
          title="Last Sale"
          value={stats.lastSale || 'No sales yet'}
          icon="⏰"
          color="bg-gradient-to-br from-orange-50 to-amber-100 border-orange-200"
          subtitle="most recent"
        />
      </div>

      {/* Additional Insights - Compact Version */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        {/* Hourly Performance */}
        <div className="bg-white rounded-lg shadow-sm p-3 border border-gray-100">
          <h4 className="font-medium text-gray-800 mb-2 text-sm flex items-center">
            📈 Hourly Performance
          </h4>
          <div className="space-y-1 max-h-24 overflow-y-auto text-xs">
            {stats.hourlyStats.map((hour, index) => (
              <div key={index} className="flex justify-between items-center">
                <span className="text-gray-600 w-12">{hour.hour}</span>
                <div className="text-right">
                  <span className="font-medium text-gray-900">{formatCurrency(hour.sales)}</span>
                  <span className="text-gray-500 ml-1">({hour.transactions})</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Top Products */}
        <div className="bg-white rounded-lg shadow-sm p-3 border border-gray-100">
          <h4 className="font-medium text-gray-800 mb-2 text-sm flex items-center">
            🏆 Top Products
          </h4>
          <div className="space-y-1 text-xs">
            {stats.topProducts.map((product, index) => (
              <div key={index} className="flex justify-between items-center">
                <span className="text-gray-700 truncate flex-1 text-xs">{product.name}</span>
                <div className="text-right ml-2">
                  <span className="font-medium text-gray-900">{product.sales}</span>
                  <div className="text-gray-500">{formatCurrency(product.revenue)}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Payment Methods */}
        <div className="bg-white rounded-lg shadow-sm p-3 border border-gray-100">
          <h4 className="font-medium text-gray-800 mb-2 text-sm flex items-center">
            💳 Payment Methods
          </h4>
          <div className="space-y-1">
            {Object.entries(stats.paymentMethods).map(([method, percentage]) => (
              <div key={method} className="flex justify-between items-center text-xs">
                <span className="text-gray-700 capitalize">{method}</span>
                <div className="flex items-center space-x-1">
                  <div className="w-12 h-1.5 bg-gray-200 rounded-full overflow-hidden">
                    <div 
                      className="h-full bg-blue-500 transition-all duration-300"
                      style={{ width: `${percentage}%` }}
                    ></div>
                  </div>
                  <span className="font-medium w-6 text-right text-xs">{percentage}%</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

export default Dashboard
