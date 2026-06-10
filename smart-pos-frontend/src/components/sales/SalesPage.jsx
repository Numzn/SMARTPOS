import { Navigate } from 'react-router-dom';

/** Legacy /sales route — unified POS lives at /cashier */
const SalesPage = () => <Navigate to="/cashier" replace />;

export default SalesPage;
